import type { Role, Permission } from '../core/permissions'
import type { ChargeKind } from '../core/billing'

/**
 * Display words for the codes the data keeps (roles, wards, charge kinds).
 * Presentation only: the database and the engine keep their codes.
 */

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  RECEPTION: 'Reception',
  DOCTOR: 'Doctor',
  NURSE: 'Nurse',
  BILLING: 'Billing desk',
}

/** One line per role, in the visitor's terms. Each matches the role's row in core/permissions.ts. */
export const ROLE_BLURBS: Record<Role, string> = {
  ADMIN: 'Can do everything, and sees staff pay and the event log.',
  RECEPTION: 'Registers, admits, moves and discharges patients, takes deposits, sends ambulances.',
  DOCTOR: 'Reads charts and adds charges for the care given.',
  NURSE: 'Reads charts and the ward. Cannot change anything.',
  BILLING: 'Sees every bill, adds charges and takes deposits.',
}

export const ROLE_ORDER: Role[] = ['ADMIN', 'RECEPTION', 'DOCTOR', 'NURSE', 'BILLING']

/** Each role as it reads in "only ... can" sentences. */
export const ROLE_WHO: Record<Role, string> = {
  ADMIN: 'the administrator',
  RECEPTION: 'reception',
  DOCTOR: 'doctors',
  NURSE: 'nurses',
  BILLING: 'the billing desk',
}

/** One person in the role, as it reads after "as" or "to": "as a nurse", "open to the billing desk". */
export const ROLE_AS: Record<Role, string> = {
  ADMIN: 'the administrator',
  RECEPTION: 'reception',
  DOCTOR: 'a doctor',
  NURSE: 'a nurse',
  BILLING: 'the billing desk',
}

/** A list of roles as a sentence, the administrator last: "reception, doctors and the administrator". */
export function listRoles(roles: Role[], conjunction: 'and' | 'or'): string {
  const ordered = [...roles.filter((r) => r !== 'ADMIN'), ...roles.filter((r) => r === 'ADMIN')]
  const names = ordered.map((r) => ROLE_WHO[r])
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} ${conjunction} ${names[names.length - 1]}`
}

export const WARD_LABELS: Record<string, string> = {
  GENERAL: 'General ward',
  TWIN: 'Twin sharing',
  PRIVATE: 'Private rooms',
  ICU: 'Intensive care',
}

/** The CSS custom-property suffix for each ward's colour (--ward-general, ...). */
export const WARD_TOKENS: Record<string, string> = {
  GENERAL: 'general',
  TWIN: 'twin',
  PRIVATE: 'private',
  ICU: 'icu',
}

export const CHARGE_KIND_LABELS: Record<ChargeKind, string> = {
  PROCEDURE: 'Procedure',
  PHARMACY: 'Pharmacy',
  CONSULTATION: 'Consultation',
  TRANSPORT: 'Transport',
}

/** The six actions a visitor can try, as the permission each one needs. */
export const ACTION_COLUMNS: { permission: Permission; label: string }[] = [
  { permission: 'ADMIT', label: 'Admit' },
  { permission: 'TRANSFER', label: 'Move bed' },
  { permission: 'DISCHARGE', label: 'Discharge' },
  { permission: 'ADD_CHARGE', label: 'Add charge' },
  { permission: 'RECORD_DEPOSIT', label: 'Take deposit' },
  { permission: 'DISPATCH_AMBULANCE', label: 'Send ambulance' },
]
