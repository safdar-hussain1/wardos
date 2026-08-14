import type { Db } from '../db/database'
import type { EventAction, EventRow } from './events'
import type { PatientRow } from './engine'
import type { StaffRow } from './staff'
import type { ChargeKind, ComputedInvoice } from './billing'
import { addP } from './money'

/**
 * C2 (replay / time-machine): `replay` folds the append-only `events` table
 * into a plain-object projection (`Snapshot`) of the *operational* tables —
 * patients, admissions, charges, invoices, dispatches, staff.
 *
 * Scope note (spec §3, C2): `users` is intentionally excluded. Password
 * hashes never enter the event log — `USER_CREATED`'s payload deliberately
 * omits `password`/`passwordHash` (see engine.ts `createUser`) — so there is
 * no way, and no need, to reconstruct the `users` table from history. A
 * time-machine snapshot of the hospital's operations never needs to answer
 * "who could log in at instant T".
 */

// ---------------------------------------------------------------------
// Row shapes (camelCase, mirroring the live tables 1:1 except where noted).
// ---------------------------------------------------------------------

/** Bed config row (id/label/ward/rate) — beds are static seed data, never
 * event-sourced (there is no BED_ADDED action), so they are supplied by the
 * caller rather than folded from `events`. */
export interface BedRow {
  id: number
  label: string
  ward: string
  ratePaise: number
}

export interface AdmissionRow {
  id: number
  patientId: number
  bedId: number
  diagnosis: string
  depositPaise: number
  status: 'ACTIVE' | 'DISCHARGED'
  admittedAt: string
  dischargedAt: string | null
}

export interface ChargeRow {
  id: number
  admissionId: number
  kind: ChargeKind
  description: string
  amountPaise: number
  chargedAt: string
}

/**
 * Mirrors the `invoices` table's business columns.
 *
 * Deliberately excludes the table's own surrogate `id` (INTEGER PRIMARY
 * KEY / SQLite rowid): the DISCHARGED event's payload is `{admissionId,
 * invoice}` (see engine.ts `discharge()`) and never carries the invoice
 * row's own id — only the admission it belongs to. That id is also never
 * consulted anywhere else in the codebase (`invoiceFor` looks up invoices
 * by `admission_id`, not `id`; there is no other table with an
 * `invoice_id` foreign key) — it is a storage-internal artifact, not
 * domain state. `admission_id` is the real business key (UNIQUE per
 * invoice), so it is what keys `Snapshot.invoices` on both sides.
 */
export interface InvoiceRow {
  admissionId: number
  nights: number
  roomRatePaise: number
  roomTotalPaise: number
  extrasTotalPaise: number
  depositPaise: number
  balancePaise: number
  issuedAt: string
}

export interface DispatchRow {
  id: number
  ambulanceId: number
  location: string
  admissionId: number | null
  dispatchedAt: string
  returnedAt: string | null
}

export interface Snapshot {
  patients: Map<number, PatientRow>
  admissions: Map<number, AdmissionRow>
  charges: Map<number, ChargeRow>
  invoices: Map<number, InvoiceRow>
  dispatches: Map<number, DispatchRow>
  staff: Map<number, StaffRow>
}

function emptySnapshot(): Snapshot {
  return {
    patients: new Map(),
    admissions: new Map(),
    charges: new Map(),
    invoices: new Map(),
    dispatches: new Map(),
    staff: new Map(),
  }
}

// ---------------------------------------------------------------------
// Event payload shapes, as actually written by engine.ts's appendEvent
// calls. Kept private/narrow — this file is the one place that has to
// know the payload contract.
// ---------------------------------------------------------------------

interface PatientRegisteredPayload {
  name: string
  gender: 'F' | 'M' | 'O'
  dobIso: string
  phone: string
  idLast4: string
  patientId: number
  mrn: string
}

interface StaffAddedPayload {
  name: string
  type: string
  department: string
  base_paise: number
  years_service: number
  specialty: string | null
  icu_assigned: number
  night_shifts: number
  on_call: number
  joined_at: string
  staffId: number
}

interface AdmittedPayload {
  patientId: number
  bedId: number
  diagnosis: string
  depositPaise: number
  admissionId: number
}

interface DepositRecordedPayload {
  admissionId: number
  amountPaise: number
}

interface TransferredPayload {
  admissionId: number
  toBedId: number
}

interface ChargeAddedPayload {
  admissionId: number
  kind: ChargeKind
  description: string
  amountPaise: number
  chargeId: number
}

interface DischargedPayload {
  admissionId: number
  invoice: ComputedInvoice
}

interface AmbulanceDispatchedPayload {
  ambulanceId: number
  location: string
  admissionId?: number
  dispatchId: number
}

interface AmbulanceReturnedPayload {
  dispatchId: number
}

// ---------------------------------------------------------------------
// replay
// ---------------------------------------------------------------------

/**
 * Pure fold: `events` (+ `beds` config) -> `Snapshot`. Never touches a Db.
 *
 * `uptoIso`, when given, restricts the fold to events with `at <= uptoIso`
 * (inclusive); ties on `at` are broken by ascending `id`. The full ordering
 * used to apply events is always (`at` ascending, `id` ascending) —
 * `replay` sorts defensively rather than trusting caller order, since
 * `Engine.eventsLog()` itself returns newest-first (callers commonly pass
 * that straight through).
 *
 * `beds` is accepted (not used by this function's own logic) purely for
 * signature parity with the Task 14 time-machine consumer, which zips a
 * Snapshot's `admissions` against bed config to render the ward board at
 * a scrubbed instant. Every field this function folds into the Snapshot
 * (including invoice room rates) already arrives via the event payloads —
 * see `InvoiceRow`'s doc comment and billing.ts vs. this file: replay never
 * recomputes billing math, it reconstructs the frozen `invoice` the
 * DISCHARGED event carried.
 */
export function replay(events: EventRow[], beds: BedRow[], uptoIso?: string): Snapshot {
  void beds

  const snapshot = emptySnapshot()
  const scoped = uptoIso === undefined ? events : events.filter((e) => e.at <= uptoIso)
  const ordered = [...scoped].sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? -1 : 1
    return a.id - b.id
  })

  for (const event of ordered) {
    applyEvent(snapshot, event)
  }
  return snapshot
}

function applyEvent(snapshot: Snapshot, event: EventRow): void {
  const payload = JSON.parse(event.payload) as unknown

  switch (event.action) {
    case 'PATIENT_REGISTERED': {
      const p = payload as PatientRegisteredPayload
      snapshot.patients.set(p.patientId, {
        id: p.patientId,
        mrn: p.mrn,
        name: p.name,
        gender: p.gender,
        dob: p.dobIso,
        phone: p.phone,
        idLast4: p.idLast4,
        createdAt: event.at,
      })
      return
    }
    case 'STAFF_ADDED': {
      const s = payload as StaffAddedPayload
      snapshot.staff.set(s.staffId, {
        id: s.staffId,
        name: s.name,
        type: s.type,
        department: s.department,
        base_paise: s.base_paise,
        years_service: s.years_service,
        specialty: s.specialty ?? null,
        icu_assigned: s.icu_assigned,
        night_shifts: s.night_shifts,
        on_call: s.on_call,
        joined_at: s.joined_at,
      })
      return
    }
    case 'ADMITTED': {
      const x = payload as AdmittedPayload
      snapshot.admissions.set(x.admissionId, {
        id: x.admissionId,
        patientId: x.patientId,
        bedId: x.bedId,
        diagnosis: x.diagnosis,
        depositPaise: x.depositPaise,
        status: 'ACTIVE',
        admittedAt: event.at,
        dischargedAt: null,
      })
      return
    }
    case 'DEPOSIT_RECORDED': {
      const x = payload as DepositRecordedPayload
      const admission = requireAdmission(snapshot, x.admissionId, event)
      snapshot.admissions.set(x.admissionId, {
        ...admission,
        depositPaise: addP(admission.depositPaise, x.amountPaise),
      })
      return
    }
    case 'TRANSFERRED': {
      const x = payload as TransferredPayload
      const admission = requireAdmission(snapshot, x.admissionId, event)
      snapshot.admissions.set(x.admissionId, { ...admission, bedId: x.toBedId })
      return
    }
    case 'CHARGE_ADDED': {
      const x = payload as ChargeAddedPayload
      snapshot.charges.set(x.chargeId, {
        id: x.chargeId,
        admissionId: x.admissionId,
        kind: x.kind,
        description: x.description,
        amountPaise: x.amountPaise,
        chargedAt: event.at,
      })
      return
    }
    case 'DISCHARGED': {
      const x = payload as DischargedPayload
      const admission = requireAdmission(snapshot, x.admissionId, event)
      snapshot.admissions.set(x.admissionId, {
        ...admission,
        status: 'DISCHARGED',
        dischargedAt: event.at,
      })
      snapshot.invoices.set(x.admissionId, {
        admissionId: x.admissionId,
        nights: x.invoice.nights,
        roomRatePaise: x.invoice.roomRatePaise,
        roomTotalPaise: x.invoice.roomTotalPaise,
        extrasTotalPaise: x.invoice.extrasTotalPaise,
        depositPaise: x.invoice.depositPaise,
        balancePaise: x.invoice.balancePaise,
        issuedAt: event.at,
      })
      return
    }
    case 'AMBULANCE_DISPATCHED': {
      const x = payload as AmbulanceDispatchedPayload
      snapshot.dispatches.set(x.dispatchId, {
        id: x.dispatchId,
        ambulanceId: x.ambulanceId,
        location: x.location,
        admissionId: x.admissionId ?? null,
        dispatchedAt: event.at,
        returnedAt: null,
      })
      return
    }
    case 'AMBULANCE_RETURNED': {
      const x = payload as AmbulanceReturnedPayload
      const dispatch = snapshot.dispatches.get(x.dispatchId)
      if (!dispatch) {
        throw new Error(`replay: AMBULANCE_RETURNED (event ${event.id}) for unknown dispatch ${x.dispatchId}`)
      }
      snapshot.dispatches.set(x.dispatchId, { ...dispatch, returnedAt: event.at })
      return
    }
    case 'USER_CREATED':
      // Out of scope — see module doc comment. `users` is not part of
      // Snapshot at all.
      return
    default: {
      // Exhaustiveness guard: a new EventAction added to events.ts without
      // a matching case here is an engine/replay drift bug, not silently
      // ignored.
      const unhandled: never = event.action
      throw new Error(`replay: unhandled event action ${String(unhandled as EventAction)}`)
    }
  }
}

function requireAdmission(snapshot: Snapshot, admissionId: number, event: EventRow): AdmissionRow {
  const admission = snapshot.admissions.get(admissionId)
  if (!admission) {
    throw new Error(
      `replay: ${event.action} (event ${event.id}) references unknown admission ${admissionId}`,
    )
  }
  return admission
}

// ---------------------------------------------------------------------
// snapshotFromDb
// ---------------------------------------------------------------------

interface PatientDbRow {
  id: number
  mrn: string
  name: string
  gender: 'F' | 'M' | 'O'
  dob: string
  phone: string
  id_last4: string
  created_at: string
}

interface AdmissionDbRow {
  id: number
  patient_id: number
  bed_id: number
  diagnosis: string
  deposit_paise: number
  status: 'ACTIVE' | 'DISCHARGED'
  admitted_at: string
  discharged_at: string | null
}

interface ChargeDbRow {
  id: number
  admission_id: number
  kind: ChargeKind
  description: string
  amount_paise: number
  charged_at: string
}

interface InvoiceDbRow {
  id: number
  admission_id: number
  nights: number
  room_rate_paise: number
  room_total_paise: number
  extras_total_paise: number
  deposit_paise: number
  balance_paise: number
  issued_at: string
}

interface DispatchDbRow {
  id: number
  ambulance_id: number
  location: string
  admission_id: number | null
  dispatched_at: string
  returned_at: string | null
}

/**
 * Reads the live operational tables (patients, admissions, charges,
 * invoices, dispatches, staff — same six as `replay`, excluding `users`)
 * into the same `Snapshot` shape, for comparison against `replay`'s output
 * (C2).
 */
export function snapshotFromDb(db: Db): Snapshot {
  const snapshot = emptySnapshot()

  for (const r of db.all<PatientDbRow>(`SELECT * FROM patients`)) {
    snapshot.patients.set(r.id, {
      id: r.id,
      mrn: r.mrn,
      name: r.name,
      gender: r.gender,
      dob: r.dob,
      phone: r.phone,
      idLast4: r.id_last4,
      createdAt: r.created_at,
    })
  }

  for (const r of db.all<AdmissionDbRow>(`SELECT * FROM admissions`)) {
    snapshot.admissions.set(r.id, {
      id: r.id,
      patientId: r.patient_id,
      bedId: r.bed_id,
      diagnosis: r.diagnosis,
      depositPaise: r.deposit_paise,
      status: r.status,
      admittedAt: r.admitted_at,
      dischargedAt: r.discharged_at ?? null,
    })
  }

  for (const r of db.all<ChargeDbRow>(`SELECT * FROM charges`)) {
    snapshot.charges.set(r.id, {
      id: r.id,
      admissionId: r.admission_id,
      kind: r.kind,
      description: r.description,
      amountPaise: r.amount_paise,
      chargedAt: r.charged_at,
    })
  }

  for (const r of db.all<InvoiceDbRow>(`SELECT * FROM invoices`)) {
    // Keyed by admission_id, not the invoice's own id — see InvoiceRow doc.
    snapshot.invoices.set(r.admission_id, {
      admissionId: r.admission_id,
      nights: r.nights,
      roomRatePaise: r.room_rate_paise,
      roomTotalPaise: r.room_total_paise,
      extrasTotalPaise: r.extras_total_paise,
      depositPaise: r.deposit_paise,
      balancePaise: r.balance_paise,
      issuedAt: r.issued_at,
    })
  }

  for (const r of db.all<DispatchDbRow>(`SELECT * FROM dispatches`)) {
    snapshot.dispatches.set(r.id, {
      id: r.id,
      ambulanceId: r.ambulance_id,
      location: r.location,
      admissionId: r.admission_id ?? null,
      dispatchedAt: r.dispatched_at,
      returnedAt: r.returned_at ?? null,
    })
  }

  for (const r of db.all<StaffRow>(`SELECT * FROM staff`)) {
    snapshot.staff.set(r.id, r)
  }

  return snapshot
}

// ---------------------------------------------------------------------
// snapshotsEqual
// ---------------------------------------------------------------------

const MAX_DIFF_LINES = 20

/** SQLite hands back numbers/strings/null; normalize null/undefined to a
 * single representation so equality is honest across both call sites. */
function normalizeValue(v: unknown): string | number | null {
  return v === undefined || v === null ? null : (v as string | number)
}

function compareRows(
  table: string,
  id: number,
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  diff: string[],
): void {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of [...keys].sort()) {
    if (diff.length >= MAX_DIFF_LINES) return
    const va = normalizeValue(a[key])
    const vb = normalizeValue(b[key])
    if (va !== vb) {
      diff.push(`${table}[${id}].${key}: ${JSON.stringify(va)} !== ${JSON.stringify(vb)}`)
    }
  }
}

function compareTable(
  table: string,
  a: Map<number, Record<string, unknown>>,
  b: Map<number, Record<string, unknown>>,
  diff: string[],
): void {
  const ids = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x - y)
  for (const id of ids) {
    if (diff.length >= MAX_DIFF_LINES) return
    const rowA = a.get(id)
    const rowB = b.get(id)
    if (rowA === undefined) {
      diff.push(`${table}[${id}]: present only in b (missing in a)`)
      continue
    }
    if (rowB === undefined) {
      diff.push(`${table}[${id}]: present only in a (missing in b)`)
      continue
    }
    compareRows(table, id, rowA, rowB, diff)
  }
}

/**
 * `compareTable` only needs to enumerate/read fields generically (it never
 * constructs a value of the row type), so a plain-object row of any shape
 * is safe to treat as `Record<string, unknown>` here — this cast just
 * bridges the concrete `*Row` interfaces (which intentionally have no
 * index signature, so they stay precisely typed everywhere else) to that
 * generic comparison helper.
 */
function asRecordMap<T extends object>(m: Map<number, T>): Map<number, Record<string, unknown>> {
  return m as unknown as Map<number, Record<string, unknown>>
}

/**
 * Deep-compares two Snapshots table-by-table, id-by-id, field-by-field.
 * Returns up to ~20 mismatch lines naming `table[id].column: a !== b` (or a
 * "present only in a/b" line for a missing row) — enough to debug a C2
 * failure without dumping the whole state.
 */
export function snapshotsEqual(a: Snapshot, b: Snapshot): { equal: boolean; diff: string[] } {
  const diff: string[] = []
  compareTable('patients', asRecordMap(a.patients), asRecordMap(b.patients), diff)
  compareTable('admissions', asRecordMap(a.admissions), asRecordMap(b.admissions), diff)
  compareTable('charges', asRecordMap(a.charges), asRecordMap(b.charges), diff)
  compareTable('invoices', asRecordMap(a.invoices), asRecordMap(b.invoices), diff)
  compareTable('dispatches', asRecordMap(a.dispatches), asRecordMap(b.dispatches), diff)
  compareTable('staff', asRecordMap(a.staff), asRecordMap(b.staff), diff)
  return { equal: diff.length === 0, diff }
}
