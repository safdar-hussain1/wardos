import type { Role, Permission } from './permissions'

/** Thrown by every Engine command when the acting role lacks the required permission. */
export class AccessDeniedError extends Error {
  readonly role: Role
  readonly permission: Permission

  constructor(role: Role, permission: Permission) {
    super(`${role} is not permitted to ${permission}`)
    this.name = 'AccessDeniedError'
    this.role = role
    this.permission = permission
  }
}

/**
 * Thrown for domain-rule violations: schema constraint failures translated into a
 * human-readable message (occupied bed, double admit, double dispatch, discharging
 * an already-discharged admission, etc.) as well as explicit business-rule checks.
 */
export class RuleViolationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuleViolationError'
  }
}
