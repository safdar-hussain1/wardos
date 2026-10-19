import type { Role } from '../core/permissions'
import { can } from '../core/permissions'
import { listRoles, ROLE_ORDER } from './labels'

/**
 * The app's views, addressed by the URL hash (#bills, #staff, ...) so the
 * browser's back button, reloads and shared links all land where expected.
 * The page is a single static file on GitHub Pages, so the hash is the one
 * part of the URL that never needs a server.
 */
export type RouteKey = 'hospital' | 'bills' | 'ambulances' | 'staff' | 'event-log' | 'measurements'

export interface RouteDef {
  key: RouteKey
  label: string
  /**
   * Whether a role may open this view. Views only read; every change a view
   * offers is a command, and the engine checks each command's role itself.
   */
  allowed: (role: Role) => boolean
}

export const ROUTES: RouteDef[] = [
  { key: 'hospital', label: 'Hospital', allowed: () => true },
  { key: 'bills', label: 'Bills', allowed: (role) => can(role, 'VIEW_BILLING') },
  { key: 'ambulances', label: 'Ambulances', allowed: (role) => can(role, 'VIEW_CLINICAL') },
  { key: 'staff', label: 'Staff', allowed: (role) => role === 'ADMIN' },
  { key: 'event-log', label: 'Event log', allowed: (role) => role === 'ADMIN' },
  { key: 'measurements', label: 'Measurements', allowed: () => true },
]

/** Who may open a view, in words ("the billing desk and the administrator"), read from `allowed`. */
export function whoCan(def: RouteDef): string {
  const roles = ROLE_ORDER.filter((r) => def.allowed(r))
  return roles.length === ROLE_ORDER.length ? 'everyone' : listRoles(roles, 'and')
}

/** The views in the main navigation, in order (Measurements is reached from the page itself). */
export const NAV_ROUTES: RouteKey[] = ['hospital', 'bills', 'ambulances', 'staff', 'event-log']

export function routeDef(key: RouteKey): RouteDef {
  const def = ROUTES.find((r) => r.key === key)
  if (!def) throw new Error(`unknown route ${key}`)
  return def
}

/** A section of the Hospital view that a hash can point at directly. */
export const HOW_IT_WORKS_ANCHOR = 'how-it-works'

/**
 * Every key the URL may carry, in the hash or in `?screen=`: each view's
 * name plus a few aliases, mapped to the view that shows that content.
 */
const KEY_ALIASES: Record<string, RouteKey> = {
  hospital: 'hospital',
  [HOW_IT_WORKS_ANCHOR]: 'hospital',
  deck: 'hospital',
  ward: 'hospital',
  wards: 'hospital',
  'time-machine': 'hospital',
  bills: 'bills',
  billing: 'bills',
  ambulances: 'ambulances',
  staff: 'staff',
  payroll: 'staff',
  'event-log': 'event-log',
  audit: 'event-log',
  measurements: 'measurements',
  about: 'measurements',
  results: 'measurements',
}

/** Maps a view name from the URL (any case, with or without '#') to a route, or null when it names none. */
export function routeFromKey(raw: string | null | undefined): RouteKey | null {
  if (!raw) return null
  const key = raw.replace(/^#\/?/, '').trim().toLowerCase()
  // own keys only: "constructor" or "__proto__" must not resolve through the prototype
  return Object.hasOwn(KEY_ALIASES, key) ? KEY_ALIASES[key] : null
}

/** True when a hash points at the How it works section (any case, with or without "#/"). */
export function isHowItWorksHash(hash: string): boolean {
  return hash.replace(/^#\/?/, '').trim().toLowerCase() === HOW_IT_WORKS_ANCHOR
}

/** The route a hash selects; an empty or unknown hash is the Hospital view. */
export function routeFromHash(hash: string): RouteKey {
  return routeFromKey(hash) ?? 'hospital'
}
