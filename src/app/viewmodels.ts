import type { BedView, Engine, Actor } from '../core/engine'
import type { ComputedInvoice, InvoiceLine } from '../core/billing'
import type { Paise } from '../core/money'
import { can } from '../core/permissions'
import type { Role } from '../core/permissions'
import type { StaffMember, PayLine } from '../core/staff'
import { payBreakdown, payrollTotal } from '../core/staff'
import type { EventRow, EventAction } from '../core/events'

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
