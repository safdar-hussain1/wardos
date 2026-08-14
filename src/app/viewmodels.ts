import type { BedView, Engine, Actor } from '../core/engine'
import type { ComputedInvoice, InvoiceLine } from '../core/billing'
import type { Paise } from '../core/money'
import { can } from '../core/permissions'

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
