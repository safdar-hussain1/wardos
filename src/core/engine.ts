import bcrypt from 'bcryptjs'
import type { Db } from '../db/database'
import type { Clock } from './clock'
import type { Paise } from './money'
import type { ChargeKind, ComputedInvoice } from './billing'
import { computeInvoice } from './billing'
import type { StaffRow } from './staff'
import { staffFromRow, payrollTotal } from './staff'
import type { Role, Permission } from './permissions'
import { can } from './permissions'
import { AccessDeniedError, RuleViolationError } from './errors'
import type { EventAction, EventRow } from './events'

export interface Actor {
  userId: number
  role: Role
  username: string
}

/** addStaff's input: every StaffRow column except the auto-assigned id. */
export type StaffInput = Omit<StaffRow, 'id'>

export interface BedView {
  id: number
  label: string
  ward: string
  ratePaise: Paise
  occupied: boolean
  patientName?: string
  admissionId?: number
  admittedAt?: string
}

export interface CensusView {
  patients: number
  active: number
  bedsTotal: number
  bedsFree: number
}

export interface PayrollView {
  rows: { name: string; type: string; monthlyPaise: Paise }[]
  totalPaise: Paise
}

export interface PatientRow {
  id: number
  mrn: string
  name: string
  gender: 'F' | 'M' | 'O'
  dob: string
  phone: string
  idLast4: string
  createdAt: string
}

export interface AdmissionView {
  id: number
  patientId: number
  patientName: string
  mrn: string
  bedId: number
  bedLabel: string
  diagnosis: string
  depositPaise: Paise
  admittedAt: string
}

export interface AmbulanceDispatchView {
  id: number
  location: string
  admissionId?: number
  dispatchedAt: string
}

export interface AmbulanceView {
  id: number
  plate: string
  model: string
  openDispatch?: AmbulanceDispatchView
}

// Row shapes as sql.js hands them back (snake_case columns, SQLite's loose typing).
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
  kind: ChargeKind
  description: string
  amount_paise: number
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

interface EventDbRow {
  id: number
  at: string
  actor_user_id: number | null
  action: EventAction
  entity: string
  entity_id: number | null
  payload: string
}

export class Engine {
  readonly db: Db
  readonly clock: Clock

  constructor(db: Db, clock: Clock) {
    this.db = db
    this.clock = clock
  }

  // ---------------------------------------------------------------------
  // internal helpers
  // ---------------------------------------------------------------------

  private requirePermission(actor: Actor, permission: Permission): void {
    if (!can(actor.role, permission)) {
      throw new AccessDeniedError(actor.role, permission)
    }
  }

  private appendEvent(
    actor: Actor,
    action: EventAction,
    entity: string,
    entityId: number | null,
    payload: unknown,
  ): void {
    this.db.run(
      `INSERT INTO events (at, actor_user_id, action, entity, entity_id, payload) VALUES (?,?,?,?,?,?)`,
      [this.clock.now().toISOString(), actor.userId, action, entity, entityId, JSON.stringify(payload)],
    )
  }

  /**
   * Runs `fn` inside a single db transaction. Any error already thrown as
   * AccessDeniedError/RuleViolationError propagates unchanged; a raw SQLite
   * constraint failure is translated into a RuleViolationError — `mapError`
   * gets first refusal at a friendly message, otherwise the raw SQLite
   * message is used verbatim. Non-constraint errors propagate unchanged.
   */
  private runCommand<T>(fn: () => T, mapError?: (err: Error) => string | undefined): T {
    try {
      return this.db.inTransaction(fn)
    } catch (err) {
      if (err instanceof RuleViolationError || err instanceof AccessDeniedError) {
        throw err
      }
      const errorObj = err instanceof Error ? err : new Error(String(err))
      const mapped = mapError?.(errorObj)
      if (mapped) {
        throw new RuleViolationError(mapped)
      }
      if (/constraint/i.test(errorObj.message)) {
        throw new RuleViolationError(errorObj.message)
      }
      throw errorObj
    }
  }

  private getAdmission(admissionId: number): AdmissionDbRow | undefined {
    return this.db.get<AdmissionDbRow>(
      `SELECT id, patient_id, bed_id, diagnosis, deposit_paise, status, admitted_at, discharged_at
       FROM admissions WHERE id = ?`,
      [admissionId],
    )
  }

  private requireActiveAdmission(admissionId: number): AdmissionDbRow {
    const admission = this.getAdmission(admissionId)
    if (!admission) {
      throw new RuleViolationError('admission not found')
    }
    if (admission.status !== 'ACTIVE') {
      throw new RuleViolationError('admission is not active')
    }
    return admission
  }

  private chargeLinesFor(admissionId: number): { kind: ChargeKind; description: string; amountPaise: Paise }[] {
    const rows = this.db.all<ChargeDbRow>(
      `SELECT kind, description, amount_paise FROM charges WHERE admission_id = ? ORDER BY id`,
      [admissionId],
    )
    return rows.map((r) => ({ kind: r.kind, description: r.description, amountPaise: r.amount_paise }))
  }

  // ---------------------------------------------------------------------
  // commands
  // ---------------------------------------------------------------------

  registerPatient(
    actor: Actor,
    p: { name: string; gender: 'F' | 'M' | 'O'; dobIso: string; phone: string; idLast4: string },
  ): number {
    this.requirePermission(actor, 'REGISTER_PATIENT')
    return this.runCommand(() => {
      const next = this.db.get<{ n: number }>(`SELECT COALESCE(MAX(id),0)+1 AS n FROM patients`)
      const mrn = `WH-${String(next?.n ?? 1).padStart(4, '0')}`
      const createdAt = this.clock.now().toISOString()
      this.db.run(
        `INSERT INTO patients (mrn,name,gender,dob,phone,id_last4,created_at) VALUES (?,?,?,?,?,?,?)`,
        [mrn, p.name, p.gender, p.dobIso, p.phone, p.idLast4, createdAt],
      )
      const patientId = this.db.lastId()
      this.appendEvent(actor, 'PATIENT_REGISTERED', 'patient', patientId, { ...p, patientId, mrn })
      return patientId
    })
  }

  addStaff(actor: Actor, s: StaffInput): number {
    this.requirePermission(actor, 'MANAGE_USERS')
    return this.runCommand(() => {
      this.db.run(
        `INSERT INTO staff (name,type,department,base_paise,years_service,specialty,icu_assigned,night_shifts,on_call,joined_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          s.name,
          s.type,
          s.department,
          s.base_paise,
          s.years_service,
          s.specialty,
          s.icu_assigned,
          s.night_shifts,
          s.on_call,
          s.joined_at,
        ],
      )
      const staffId = this.db.lastId()
      this.appendEvent(actor, 'STAFF_ADDED', 'staff', staffId, { ...s, staffId })
      return staffId
    })
  }

  createUser(
    actor: Actor,
    u: { username: string; password: string; role: Role; staffId?: number },
  ): number {
    this.requirePermission(actor, 'MANAGE_USERS')
    return this.runCommand(
      () => {
        const passwordHash = bcrypt.hashSync(u.password, 10)
        this.db.run(`INSERT INTO users (username,password_hash,role,staff_id) VALUES (?,?,?,?)`, [
          u.username,
          passwordHash,
          u.role,
          u.staffId ?? null,
        ])
        const userId = this.db.lastId()
        // Never persist password/hash in the event log.
        this.appendEvent(actor, 'USER_CREATED', 'user', userId, {
          username: u.username,
          role: u.role,
          staffId: u.staffId ?? null,
        })
        return userId
      },
      (err) => (/users\.username/.test(err.message) ? 'username already taken' : undefined),
    )
  }

  admit(
    actor: Actor,
    x: { patientId: number; bedId: number; diagnosis: string; depositPaise: Paise },
  ): number {
    this.requirePermission(actor, 'ADMIT')
    return this.runCommand(
      () => {
        const admittedAt = this.clock.now().toISOString()
        this.db.run(
          `INSERT INTO admissions (patient_id,bed_id,diagnosis,deposit_paise,status,admitted_at)
           VALUES (?,?,?,?,'ACTIVE',?)`,
          [x.patientId, x.bedId, x.diagnosis, x.depositPaise, admittedAt],
        )
        const admissionId = this.db.lastId()
        this.appendEvent(actor, 'ADMITTED', 'admission', admissionId, { ...x, admissionId })
        return admissionId
      },
      (err) => {
        if (/admissions\.bed_id/.test(err.message)) return 'bed is occupied'
        if (/admissions\.patient_id/.test(err.message)) return 'patient is already admitted'
        return undefined
      },
    )
  }

  recordDeposit(actor: Actor, x: { admissionId: number; amountPaise: Paise }): void {
    this.requirePermission(actor, 'RECORD_DEPOSIT')
    this.runCommand(() => {
      this.requireActiveAdmission(x.admissionId)
      this.db.run(`UPDATE admissions SET deposit_paise = deposit_paise + ? WHERE id = ?`, [
        x.amountPaise,
        x.admissionId,
      ])
      this.appendEvent(actor, 'DEPOSIT_RECORDED', 'admission', x.admissionId, { ...x })
    })
  }

  transfer(actor: Actor, x: { admissionId: number; toBedId: number }): void {
    this.requirePermission(actor, 'TRANSFER')
    this.runCommand(
      () => {
        this.requireActiveAdmission(x.admissionId)
        this.db.run(`UPDATE admissions SET bed_id = ? WHERE id = ?`, [x.toBedId, x.admissionId])
        this.appendEvent(actor, 'TRANSFERRED', 'admission', x.admissionId, { ...x })
      },
      (err) => (/admissions\.bed_id/.test(err.message) ? 'bed is occupied' : undefined),
    )
  }

  addCharge(
    actor: Actor,
    x: { admissionId: number; kind: ChargeKind; description: string; amountPaise: Paise },
  ): number {
    this.requirePermission(actor, 'ADD_CHARGE')
    return this.runCommand(() => {
      this.requireActiveAdmission(x.admissionId)
      const chargedAt = this.clock.now().toISOString()
      this.db.run(
        `INSERT INTO charges (admission_id,kind,description,amount_paise,charged_at) VALUES (?,?,?,?,?)`,
        [x.admissionId, x.kind, x.description, x.amountPaise, chargedAt],
      )
      const chargeId = this.db.lastId()
      this.appendEvent(actor, 'CHARGE_ADDED', 'charge', chargeId, { ...x, chargeId })
      return chargeId
    })
  }

  discharge(actor: Actor, x: { admissionId: number }): ComputedInvoice {
    this.requirePermission(actor, 'DISCHARGE')
    return this.runCommand(() => {
      const admission = this.requireActiveAdmission(x.admissionId)
      const bed = this.db.get<{ rate_paise: number }>(`SELECT rate_paise FROM beds WHERE id = ?`, [
        admission.bed_id,
      ])
      if (!bed) {
        throw new RuleViolationError('bed not found')
      }

      const dischargedAt = this.clock.now().toISOString()
      const invoice = computeInvoice({
        admittedAtIso: admission.admitted_at,
        dischargedAtIso: dischargedAt,
        roomRatePaise: bed.rate_paise,
        lines: this.chargeLinesFor(x.admissionId),
        depositPaise: admission.deposit_paise,
      })

      this.db.run(
        `INSERT INTO invoices
           (admission_id,nights,room_rate_paise,room_total_paise,extras_total_paise,deposit_paise,balance_paise,issued_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          x.admissionId,
          invoice.nights,
          invoice.roomRatePaise,
          invoice.roomTotalPaise,
          invoice.extrasTotalPaise,
          invoice.depositPaise,
          invoice.balancePaise,
          dischargedAt,
        ],
      )
      this.db.run(`UPDATE admissions SET status = 'DISCHARGED', discharged_at = ? WHERE id = ?`, [
        dischargedAt,
        x.admissionId,
      ])
      this.appendEvent(actor, 'DISCHARGED', 'admission', x.admissionId, {
        admissionId: x.admissionId,
        invoice,
      })
      return invoice
    })
  }

  dispatchAmbulance(
    actor: Actor,
    x: { ambulanceId: number; location: string; admissionId?: number },
  ): number {
    this.requirePermission(actor, 'DISPATCH_AMBULANCE')
    return this.runCommand(
      () => {
        const dispatchedAt = this.clock.now().toISOString()
        this.db.run(
          `INSERT INTO dispatches (ambulance_id,location,admission_id,dispatched_at) VALUES (?,?,?,?)`,
          [x.ambulanceId, x.location, x.admissionId ?? null, dispatchedAt],
        )
        const dispatchId = this.db.lastId()
        this.appendEvent(actor, 'AMBULANCE_DISPATCHED', 'dispatch', dispatchId, { ...x, dispatchId })
        return dispatchId
      },
      (err) => (/dispatches\.ambulance_id/.test(err.message) ? 'ambulance already dispatched' : undefined),
    )
  }

  returnAmbulance(actor: Actor, x: { dispatchId: number }): void {
    this.requirePermission(actor, 'RETURN_AMBULANCE')
    this.runCommand(() => {
      const dispatch = this.db.get<{ id: number; returned_at: string | null }>(
        `SELECT id, returned_at FROM dispatches WHERE id = ?`,
        [x.dispatchId],
      )
      if (!dispatch) {
        throw new RuleViolationError('dispatch not found')
      }
      if (dispatch.returned_at !== null) {
        throw new RuleViolationError('dispatch already returned')
      }
      const returnedAt = this.clock.now().toISOString()
      this.db.run(`UPDATE dispatches SET returned_at = ? WHERE id = ?`, [returnedAt, x.dispatchId])
      this.appendEvent(actor, 'AMBULANCE_RETURNED', 'dispatch', x.dispatchId, { ...x })
    })
  }

  // ---------------------------------------------------------------------
  // auth
  // ---------------------------------------------------------------------

  authenticate(username: string, password: string): Actor {
    const user = this.db.get<{ id: number; username: string; password_hash: string; role: Role }>(
      `SELECT id, username, password_hash, role FROM users WHERE username = ?`,
      [username],
    )
    // Same generic error for unknown user and wrong password — no user enumeration.
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      throw new Error('invalid credentials')
    }
    return { userId: user.id, role: user.role, username: user.username }
  }

  // ---------------------------------------------------------------------
  // queries
  // ---------------------------------------------------------------------

  beds(): BedView[] {
    const rows = this.db.all<{
      id: number
      label: string
      ward: string
      rate_paise: number
      admission_id: number | null
      patient_name: string | null
      admitted_at: string | null
    }>(`
      SELECT b.id, b.label, b.ward, b.rate_paise,
             a.id AS admission_id, p.name AS patient_name, a.admitted_at AS admitted_at
      FROM beds b
      LEFT JOIN admissions a ON a.bed_id = b.id AND a.status = 'ACTIVE'
      LEFT JOIN patients p ON p.id = a.patient_id
      ORDER BY b.id
    `)
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      ward: r.ward,
      ratePaise: r.rate_paise,
      occupied: r.admission_id !== null,
      patientName: r.patient_name ?? undefined,
      admissionId: r.admission_id ?? undefined,
      admittedAt: r.admitted_at ?? undefined,
    }))
  }

  census(): CensusView {
    const patients = this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM patients`)?.n ?? 0
    const active =
      this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM admissions WHERE status = 'ACTIVE'`)?.n ?? 0
    const bedsTotal = this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM beds`)?.n ?? 0
    return { patients, active, bedsTotal, bedsFree: bedsTotal - active }
  }

  billPreview(admissionId: number, nowIso?: string): ComputedInvoice {
    const admission = this.getAdmission(admissionId)
    if (!admission) {
      throw new RuleViolationError('admission not found')
    }
    if (admission.status === 'DISCHARGED') {
      const invoice = this.invoiceFor(admissionId)
      if (!invoice) {
        throw new RuleViolationError('invoice not found')
      }
      const { issuedAt: _issuedAt, ...computed } = invoice
      return computed
    }
    const bed = this.db.get<{ rate_paise: number }>(`SELECT rate_paise FROM beds WHERE id = ?`, [
      admission.bed_id,
    ])
    if (!bed) {
      throw new RuleViolationError('bed not found')
    }
    return computeInvoice({
      admittedAtIso: admission.admitted_at,
      dischargedAtIso: nowIso ?? this.clock.now().toISOString(),
      roomRatePaise: bed.rate_paise,
      lines: this.chargeLinesFor(admissionId),
      depositPaise: admission.deposit_paise,
    })
  }

  invoiceFor(admissionId: number): (ComputedInvoice & { issuedAt: string }) | undefined {
    const invoice = this.db.get<InvoiceDbRow>(`SELECT * FROM invoices WHERE admission_id = ?`, [
      admissionId,
    ])
    if (!invoice) {
      return undefined
    }
    const balancePaise = invoice.balance_paise
    const isRefund = balancePaise < 0
    return {
      nights: invoice.nights,
      roomRatePaise: invoice.room_rate_paise,
      roomTotalPaise: invoice.room_total_paise,
      lines: this.chargeLinesFor(admissionId),
      extrasTotalPaise: invoice.extras_total_paise,
      depositPaise: invoice.deposit_paise,
      balancePaise,
      isRefund,
      refundPaise: isRefund ? -balancePaise : 0,
      issuedAt: invoice.issued_at,
    }
  }

  payroll(): PayrollView {
    const rows = this.db.all<StaffRow>(`SELECT * FROM staff ORDER BY id`)
    const members = rows.map((r) => staffFromRow(r))
    return {
      rows: members.map((m, i) => ({ name: m.name, type: rows[i].type, monthlyPaise: m.monthlyPay() })),
      totalPaise: payrollTotal(members),
    }
  }

  eventsLog(limit?: number, offset = 0): EventRow[] {
    // SQLite treats a negative LIMIT as "no limit" — used when `limit` is omitted.
    const lim = limit ?? -1
    const rows = this.db.all<EventDbRow>(`SELECT * FROM events ORDER BY id DESC LIMIT ? OFFSET ?`, [
      lim,
      offset,
    ])
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      actorUserId: r.actor_user_id,
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
      payload: r.payload,
    }))
  }

  patients(query?: string): PatientRow[] {
    const rows = query
      ? this.db.all<PatientDbRow>(
          `SELECT * FROM patients WHERE name LIKE ? OR mrn LIKE ? ORDER BY id`,
          [`%${query}%`, `%${query}%`],
        )
      : this.db.all<PatientDbRow>(`SELECT * FROM patients ORDER BY id`)
    return rows.map((r) => ({
      id: r.id,
      mrn: r.mrn,
      name: r.name,
      gender: r.gender,
      dob: r.dob,
      phone: r.phone,
      idLast4: r.id_last4,
      createdAt: r.created_at,
    }))
  }

  admissionsActive(): AdmissionView[] {
    const rows = this.db.all<{
      id: number
      patient_id: number
      patient_name: string
      mrn: string
      bed_id: number
      bed_label: string
      diagnosis: string
      deposit_paise: number
      admitted_at: string
    }>(`
      SELECT a.id, a.patient_id, p.name AS patient_name, p.mrn, a.bed_id, b.label AS bed_label,
             a.diagnosis, a.deposit_paise, a.admitted_at
      FROM admissions a
      JOIN patients p ON p.id = a.patient_id
      JOIN beds b ON b.id = a.bed_id
      WHERE a.status = 'ACTIVE'
      ORDER BY a.id
    `)
    return rows.map((r) => ({
      id: r.id,
      patientId: r.patient_id,
      patientName: r.patient_name,
      mrn: r.mrn,
      bedId: r.bed_id,
      bedLabel: r.bed_label,
      diagnosis: r.diagnosis,
      depositPaise: r.deposit_paise,
      admittedAt: r.admitted_at,
    }))
  }

  ambulances(): AmbulanceView[] {
    const ambulanceRows = this.db.all<{ id: number; plate: string; model: string }>(
      `SELECT * FROM ambulances ORDER BY id`,
    )
    return ambulanceRows.map((amb) => {
      const open = this.db.get<{
        id: number
        location: string
        admission_id: number | null
        dispatched_at: string
      }>(`SELECT id, location, admission_id, dispatched_at FROM dispatches WHERE ambulance_id = ? AND returned_at IS NULL`, [
        amb.id,
      ])
      return {
        id: amb.id,
        plate: amb.plate,
        model: amb.model,
        openDispatch: open
          ? {
              id: open.id,
              location: open.location,
              admissionId: open.admission_id ?? undefined,
              dispatchedAt: open.dispatched_at,
            }
          : undefined,
      }
    })
  }
}
