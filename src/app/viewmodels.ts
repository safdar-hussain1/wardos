import type { BedView, Engine, Actor, CensusView } from '../core/engine'
import type { ComputedInvoice, InvoiceLine, ChargeKind } from '../core/billing'
import type { Paise } from '../core/money'
import { addP } from '../core/money'
import { can } from '../core/permissions'
import type { Role } from '../core/permissions'
import type { StaffMember, PayLine } from '../core/staff'
import { payBreakdown, payrollTotal } from '../core/staff'
import type { EventRow, EventAction } from '../core/events'
import type { BedRow } from '../core/replay'
import { replay } from '../core/replay'

/**
 * The hospital's four wards, in the fixed display order the ward board
 * always renders them — mirrors src/seed/facility.ts's WARD_LAYOUT.
 */
export const WARD_ORDER = ['GENERAL', 'TWIN', 'PRIVATE', 'ICU'] as const

export interface WardGroup {
  ward: (typeof WARD_ORDER)[number]
  beds: BedView[]
  freeCount: number
  occupiedCount: number
}

/**
 * Pure view-model builder for the ward board: groups every bed into its
 * ward, in WARD_ORDER, with per-ward free/occupied counts. A ward with no
 * beds still appears (empty group) — the board always shows all four.
 */
export function bedGrid(beds: BedView[]): WardGroup[] {
  return WARD_ORDER.map((ward) => {
    const wardBeds = beds.filter((b) => b.ward === ward)
    const occupiedCount = wardBeds.filter((b) => b.occupied).length
    return {
      ward,
      beds: wardBeds,
      freeCount: wardBeds.length - occupiedCount,
      occupiedCount,
    }
  })
}

export interface ChartPermittedActions {
  addCharge: boolean
  transfer: boolean
  discharge: boolean
  recordDeposit: boolean
}

export interface ChartVm {
  found: boolean
  admissionId: number
  patientName?: string
  mrn?: string
  bedLabel?: string
  diagnosis?: string
  depositPaise?: Paise
  admittedAt?: string
  charges: InvoiceLine[]
  isDischarged: boolean
  /** Live itemized preview, only present while the admission is still active. */
  preview?: ComputedInvoice
  /** The issued invoice, only present once the admission has been discharged. */
  invoice?: ComputedInvoice & { issuedAt: string }
  permittedActions: ChartPermittedActions
}

/**
 * Pure view-model builder for the patient chart screen: admission details,
 * charges, a live bill preview (or the final invoice if already
 * discharged), and which chart actions `actor`'s role permits — all
 * derived from existing Engine queries only, no direct db access, no
 * mutation. Mirrors engine.ts's own permission matrix so a button being
 * shown/hidden here is purely a courtesy; the engine still enforces (C5).
 */
export function chartVm(engine: Engine, actor: Actor, admissionId: number): ChartVm {
  const permittedActions: ChartPermittedActions = {
    addCharge: can(actor.role, 'ADD_CHARGE'),
    transfer: can(actor.role, 'TRANSFER'),
    discharge: can(actor.role, 'DISCHARGE'),
    recordDeposit: can(actor.role, 'RECORD_DEPOSIT'),
  }

  const active = engine.admissionsActive().find((a) => a.id === admissionId)
  if (active) {
    const preview = engine.billPreview(admissionId)
    return {
      found: true,
      admissionId,
      patientName: active.patientName,
      mrn: active.mrn,
      bedLabel: active.bedLabel,
      diagnosis: active.diagnosis,
      depositPaise: active.depositPaise,
      admittedAt: active.admittedAt,
      charges: preview.lines,
      isDischarged: false,
      preview,
      permittedActions,
    }
  }

  const invoice = engine.invoiceFor(admissionId)
  if (invoice) {
    return {
      found: true,
      admissionId,
      charges: invoice.lines,
      isDischarged: true,
      invoice,
      permittedActions,
    }
  }

  return {
    found: false,
    admissionId,
    charges: [],
    isDischarged: false,
    permittedActions,
  }
}

export interface BillingActiveRow {
  admissionId: number
  patientName: string
  mrn: string
  bedLabel: string
  /** Live itemization as of "now" — see `Engine.billPreview`. */
  preview: ComputedInvoice
}

export interface BillingDischargedRow {
  admissionId: number
  patientName: string
  mrn: string
  bedLabel: string
  /** Frozen at discharge — see `Engine.invoiceFor`. */
  invoice: ComputedInvoice & { issuedAt: string }
}

export interface BillingPermittedActions {
  recordDeposit: boolean
}

export interface BillingVm {
  active: BillingActiveRow[]
  discharged: BillingDischargedRow[]
  permittedActions: BillingPermittedActions
}

/**
 * Pure view-model builder for the billing desk: every active admission with
 * a live `billPreview` itemization, and every discharged admission with its
 * frozen `invoiceFor` invoice — plus which billing actions `actor`'s role
 * permits. Mirrors `chartVm`'s shape: existing Engine queries only, no raw
 * db access, no duplicated billing arithmetic.
 */
export function billingVm(engine: Engine, actor: Actor): BillingVm {
  const active: BillingActiveRow[] = engine.admissionsActive().map((a) => ({
    admissionId: a.id,
    patientName: a.patientName,
    mrn: a.mrn,
    bedLabel: a.bedLabel,
    preview: engine.billPreview(a.id),
  }))

  const discharged: BillingDischargedRow[] = engine
    .admissionsDischarged()
    .map((a) => {
      const invoice = engine.invoiceFor(a.id)
      return invoice
        ? { admissionId: a.id, patientName: a.patientName, mrn: a.mrn, bedLabel: a.bedLabel, invoice }
        : undefined
    })
    .filter((row): row is BillingDischargedRow => row !== undefined)

  return {
    active,
    discharged,
    permittedActions: { recordDeposit: can(actor.role, 'RECORD_DEPOSIT') },
  }
}

export interface PayrollRow {
  member: StaffMember
  roleLabel: string
  monthlyPaise: Paise
  breakdown: PayLine[]
}

export interface PayrollVm {
  rows: PayrollRow[]
  totalPaise: Paise
}

/**
 * Pure view-model builder for the payroll screen: every staff member as a
 * `StaffMember` instance (so the table can render `member.monthlyPay()`,
 * `member.roleLabel()`, etc. directly) paired with its `payBreakdown`
 * itemization, and the grand `payrollTotal`.
 */
export function payrollVm(engine: Engine): PayrollVm {
  const members = engine.staffMembers()
  const rows: PayrollRow[] = members.map((member) => ({
    member,
    roleLabel: member.roleLabel(),
    monthlyPaise: member.monthlyPay(),
    breakdown: payBreakdown(member),
  }))
  return { rows, totalPaise: payrollTotal(members) }
}

export interface AuditRow {
  id: number
  atIso: string
  actorUsername: string
  action: EventAction
  entity: string
  entityId: number | null
  /** Pretty-printed payload JSON, truncated to ~80 chars with a trailing ellipsis. */
  payloadSummary: string
  /** Full pretty-printed payload JSON (falls back to the raw string if it isn't valid JSON). */
  payloadPretty: string
}

export interface AuditPageVm {
  rows: AuditRow[]
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
  /** Distinct actions across the *full* input (ignores paging/filtering) — for the filter dropdown. */
  availableActions: EventAction[]
}

const PAYLOAD_SUMMARY_MAX = 80

function prettyPayload(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function summarizePayload(pretty: string): string {
  return pretty.length > PAYLOAD_SUMMARY_MAX ? `${pretty.slice(0, PAYLOAD_SUMMARY_MAX)}…` : pretty
}

/**
 * Pure view-model builder for the audit trail: pages and (optionally)
 * filters an already-fetched `EventRow[]` (newest-first, as
 * `Engine.eventsLog()` returns it), resolves each event's `actorUserId` to
 * a username via `users`, and renders the payload both as a short summary
 * and full pretty-printed JSON. Takes raw arrays rather than `Engine` so
 * pagination/filtering can be tested against small fixtures without a
 * database.
 */
export function auditPageVm(
  events: EventRow[],
  users: { id: number; username: string; role: Role }[],
  opts: { page: number; pageSize?: number; actionFilter?: EventAction | 'ALL' },
): AuditPageVm {
  const pageSize = opts.pageSize ?? 50
  const userMap = new Map(users.map((u) => [u.id, u.username]))

  const availableActions = Array.from(new Set(events.map((e) => e.action))).sort()

  const filtered =
    opts.actionFilter && opts.actionFilter !== 'ALL'
      ? events.filter((e) => e.action === opts.actionFilter)
      : events

  const totalCount = filtered.length
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const page = Math.min(Math.max(1, opts.page), totalPages)
  const start = (page - 1) * pageSize

  const rows: AuditRow[] = filtered.slice(start, start + pageSize).map((e) => {
    const pretty = prettyPayload(e.payload)
    return {
      id: e.id,
      atIso: e.at,
      actorUsername: e.actorUserId === null ? 'system' : (userMap.get(e.actorUserId) ?? `user#${e.actorUserId}`),
      action: e.action,
      entity: e.entity,
      entityId: e.entityId,
      payloadSummary: summarizePayload(pretty),
      payloadPretty: pretty,
    }
  })

  return {
    rows,
    page,
    pageSize,
    totalCount,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
    availableActions,
  }
}

// ---------------------------------------------------------------------
// deckVm — command deck
// ---------------------------------------------------------------------

// Fixed aggregation order — matches the `kind` CHECK constraint on the
// `charges` table (src/db/schema.sql) and src/cli/main.ts's
// CHARGE_KIND_ORDER, so a chart/legend never depends on iteration order.
const CHARGE_KIND_ORDER: ChargeKind[] = ['PROCEDURE', 'PHARMACY', 'CONSULTATION', 'TRANSPORT']

export interface DeckOccupancyRow {
  ward: (typeof WARD_ORDER)[number]
  bedsTotal: number
  occupied: number
  free: number
}

export interface DeckRevenueRow {
  kind: ChargeKind
  totalPaise: Paise
}

export interface DeckVm {
  census: CensusView
  occupancyByWard: DeckOccupancyRow[]
  revenueByKind: DeckRevenueRow[]
  /** Sum of positive unpaid balances across frozen (discharged) invoices — mirrors src/cli/main.ts's outstandingTotal. */
  outstandingPaise: Paise
  /** Count of frozen invoices with a negative balance (over-deposit refunds). */
  refundCount: number
  /** Newest-first, capped at 10 — straight from `Engine.eventsLog(10)`. */
  recentEvents: EventRow[]
}

/**
 * Pure view-model builder for the command deck: census, per-ward occupancy,
 * revenue-by-kind, outstanding balance, refund count, and the last 10
 * events — every figure read live off `engine` at render time via existing
 * Engine queries only (`census`, `beds`, `admissionsDischarged`,
 * `invoiceFor`, `eventsLog`), never `src/app/data/summary.json` (that file
 * is a frozen snapshot for the static Results page — see `About.tsx` —
 * while this screen always reflects the live db, including any demo
 * mutation the current session has made).
 *
 * Revenue-by-kind and outstanding mirror the CLI's `revenueByChargeKind`/
 * `outstandingTotal` (src/cli/main.ts) exactly — realized revenue and
 * unpaid balance are only meaningful once an admission is discharged and
 * its invoice is frozen, so both are summed over `admissionsDischarged()` +
 * `invoiceFor(id)`, not live `billPreview` accruals on still-active stays.
 */
export function deckVm(engine: Engine): DeckVm {
  const census = engine.census()

  const byWard = new Map<string, { bedsTotal: number; occupied: number }>()
  for (const bed of engine.beds()) {
    const cur = byWard.get(bed.ward) ?? { bedsTotal: 0, occupied: 0 }
    cur.bedsTotal += 1
    if (bed.occupied) cur.occupied += 1
    byWard.set(bed.ward, cur)
  }
  const occupancyByWard: DeckOccupancyRow[] = WARD_ORDER.map((ward) => {
    const v = byWard.get(ward) ?? { bedsTotal: 0, occupied: 0 }
    return { ward, bedsTotal: v.bedsTotal, occupied: v.occupied, free: v.bedsTotal - v.occupied }
  })

  const revenueMap = new Map<ChargeKind, Paise>(CHARGE_KIND_ORDER.map((k) => [k, 0]))
  let outstandingPaise: Paise = 0
  let refundCount = 0
  for (const admission of engine.admissionsDischarged()) {
    const invoice = engine.invoiceFor(admission.id)
    if (!invoice) continue
    for (const line of invoice.lines) {
      revenueMap.set(line.kind, addP(revenueMap.get(line.kind) ?? 0, line.amountPaise))
    }
    if (invoice.balancePaise > 0) outstandingPaise = addP(outstandingPaise, invoice.balancePaise)
    if (invoice.isRefund) refundCount += 1
  }
  const revenueByKind: DeckRevenueRow[] = CHARGE_KIND_ORDER.map((kind) => ({
    kind,
    totalPaise: revenueMap.get(kind) ?? 0,
  }))

  return {
    census,
    occupancyByWard,
    revenueByKind,
    outstandingPaise,
    refundCount,
    recentEvents: engine.eventsLog(10),
  }
}

// ---------------------------------------------------------------------
// timeMachineVm — time machine
// ---------------------------------------------------------------------

export interface TimeMachineBed {
  id: number
  label: string
  ward: string
  occupied: boolean
}

export interface TimeMachineVm {
  uptoIso: string
  patients: number
  activeAdmissions: number
  bedsTotal: number
  bedsFree: number
  occupancyByWard: DeckOccupancyRow[]
  /** Sum of roomTotalPaise + extrasTotalPaise over every invoice issued at or before `uptoIso`. */
  revenueToDatePaise: Paise
  /** Count of invoices issued at or before `uptoIso` with a negative balance. */
  refundsToDate: number
  /** Miniature ward-board data: every bed, occupied? as of `uptoIso`. */
  beds: TimeMachineBed[]
}

/**
 * Pure view-model builder for the time machine: `replay(events, beds,
 * uptoIso)` folds the event log into a `Snapshot` as of `uptoIso`, and this
 * function derives census/occupancy/revenue/refunds/mini-ward-board from
 * that Snapshot alone — no Engine, no Db, anywhere in this call graph.
 * `replay` itself is a pure fold over its two array arguments (see
 * core/replay.ts's own doc comment: "Never touches a Db") — this function
 * adds no i/o of its own on top of it. Callers are expected to fetch
 * `events`/`beds` once (e.g. `engine.eventsLog()` / `engine.beds()` when
 * the time-machine screen mounts) and then scrub purely by calling this
 * function repeatedly with a different `uptoIso` — see
 * tests/app-logic.test.ts's poisoned-Db-facade test, which reassigns a real
 * `Db`'s run/all/get to throw *after* that one fetch and then scrubs
 * across the full six months without tripping it.
 */
export function timeMachineVm(events: EventRow[], beds: BedRow[], uptoIso: string): TimeMachineVm {
  const snapshot = replay(events, beds, uptoIso)

  const activeAdmissions = [...snapshot.admissions.values()].filter((a) => a.status === 'ACTIVE')
  const occupiedBedIds = new Set(activeAdmissions.map((a) => a.bedId))

  const byWard = new Map<string, { bedsTotal: number; occupied: number }>()
  const tmBeds: TimeMachineBed[] = beds.map((bed) => {
    const occupied = occupiedBedIds.has(bed.id)
    const cur = byWard.get(bed.ward) ?? { bedsTotal: 0, occupied: 0 }
    cur.bedsTotal += 1
    if (occupied) cur.occupied += 1
    byWard.set(bed.ward, cur)
    return { id: bed.id, label: bed.label, ward: bed.ward, occupied }
  })
  const occupancyByWard: DeckOccupancyRow[] = WARD_ORDER.map((ward) => {
    const v = byWard.get(ward) ?? { bedsTotal: 0, occupied: 0 }
    return { ward, bedsTotal: v.bedsTotal, occupied: v.occupied, free: v.bedsTotal - v.occupied }
  })

  let revenueToDatePaise: Paise = 0
  let refundsToDate = 0
  for (const invoice of snapshot.invoices.values()) {
    revenueToDatePaise = addP(revenueToDatePaise, addP(invoice.roomTotalPaise, invoice.extrasTotalPaise))
    if (invoice.balancePaise < 0) refundsToDate += 1
  }

  return {
    uptoIso,
    patients: snapshot.patients.size,
    activeAdmissions: activeAdmissions.length,
    bedsTotal: beds.length,
    bedsFree: beds.length - occupiedBedIds.size,
    occupancyByWard,
    revenueToDatePaise,
    refundsToDate,
    beds: tmBeds,
  }
}
