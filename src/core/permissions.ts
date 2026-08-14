export type Role = 'ADMIN' | 'RECEPTION' | 'DOCTOR' | 'NURSE' | 'BILLING'

export type Permission =
  | 'REGISTER_PATIENT'
  | 'ADMIT'
  | 'TRANSFER'
  | 'DISCHARGE'
  | 'ADD_CHARGE'
  | 'RECORD_DEPOSIT'
  | 'DISPATCH_AMBULANCE'
  | 'RETURN_AMBULANCE'
  | 'VIEW_CLINICAL'
  | 'VIEW_BILLING'
  | 'MANAGE_USERS'

export const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  ADMIN: new Set([
    'REGISTER_PATIENT',
    'ADMIT',
    'TRANSFER',
    'DISCHARGE',
    'ADD_CHARGE',
    'RECORD_DEPOSIT',
    'DISPATCH_AMBULANCE',
    'RETURN_AMBULANCE',
    'VIEW_CLINICAL',
    'VIEW_BILLING',
    'MANAGE_USERS',
  ]),

  RECEPTION: new Set([
    'REGISTER_PATIENT',
    'ADMIT',
    'TRANSFER',
    'DISCHARGE',
    'RECORD_DEPOSIT',
    'DISPATCH_AMBULANCE',
    'RETURN_AMBULANCE',
    'VIEW_CLINICAL',
  ]),

  DOCTOR: new Set([
    'VIEW_CLINICAL',
    'ADD_CHARGE',
  ]),

  NURSE: new Set([
    'VIEW_CLINICAL',
  ]),

  BILLING: new Set([
    'VIEW_BILLING',
    'ADD_CHARGE',
    'RECORD_DEPOSIT',
  ]),
}

export function can(role: Role, p: Permission): boolean {
  return MATRIX[role].has(p)
}
