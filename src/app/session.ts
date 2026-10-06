import type { Role, Permission } from '../core/permissions'
import { can } from '../core/permissions'
import { DEMO_ACCOUNTS } from '../seed/facility'
import { store } from './store'
import { ROLE_LABELS, ROLE_ORDER } from './labels'

/** The demo account that holds a role (one per role). */
export function accountFor(role: Role): (typeof DEMO_ACCOUNTS)[number] {
  const account = DEMO_ACCOUNTS.find((a) => a.role === role)
  if (!account) throw new Error(`no demo account for ${role}`)
  return account
}

/**
 * Signs in as a role's demo account. This is a real sign-in: the password
 * is checked against its bcrypt hash in the database, exactly as the form
 * would.
 */
export function signInAs(role: Role): void {
  const account = accountFor(role)
  store.login(account.username, account.password)
}

/** The roles allowed a permission, in display order. */
export function rolesWith(permission: Permission): Role[] {
  return ROLE_ORDER.filter((r) => can(r, permission))
}

/** "Reception or the administrator" style list of who may do something. */
export function whoMay(permission: Permission): string {
  const roles = rolesWith(permission)
  const ordered = [...roles.filter((r) => r !== 'ADMIN'), ...roles.filter((r) => r === 'ADMIN')]
  const names = ordered.map((r) => (r === 'ADMIN' ? 'the administrator' : ROLE_LABELS[r].toLowerCase()))
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
}

/** A role, other than `current`, that may do something: the one a "switch" button offers. */
export function roleToSwitchTo(permission: Permission, current: Role): Role | undefined {
  return rolesWith(permission).find((r) => r !== current && r !== 'ADMIN') ?? rolesWith(permission).find((r) => r !== current)
}

// -- the role the app keeps signing into ------------------------------------

/**
 * The demo opens already on shift, and stays on shift across a demo reset:
 * this is the role it signs back into whenever the database has no
 * session. Null after an explicit sign-out, which shows the sign-in screen.
 */
let preferred: Role | null = null
const preferredListeners = new Set<() => void>()

export function preferredRole(): Role | null {
  return preferred
}

export function setPreferredRole(role: Role | null): void {
  preferred = role
  for (const listener of preferredListeners) listener()
}

export function subscribePreferredRole(listener: () => void): () => void {
  preferredListeners.add(listener)
  return () => preferredListeners.delete(listener)
}

/** Signs in as a role and remembers it as the role to come back to. */
export function switchRole(role: Role): void {
  setPreferredRole(role)
  signInAs(role)
}

export function signOut(): void {
  setPreferredRole(null)
  store.logout()
}
