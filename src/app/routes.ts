import type { Role } from '../core/permissions'
import { can } from '../core/permissions'

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
  /** Whether a role may open this view. The engine still checks every command on its own. */
  allowed: (role: Role) => boolean
  /** Shown when a role may not open the view: who can. */
  whoCan: string
}

export const ROUTES: RouteDef[] = [
  { key: 'hospital', label: 'Hospital', allowed: () => true, whoCan: 'everyone' },
  {
    key: 'bills',
    label: 'Bills',
    allowed: (role) => can(role, 'VIEW_BILLING'),
    whoCan: 'the billing desk and the administrator',
  },
  {
    key: 'ambulances',
    label: 'Ambulances',
    allowed: (role) => can(role, 'VIEW_CLINICAL'),
    whoCan: 'clinical staff, reception and the administrator',
  },
  { key: 'staff', label: 'Staff', allowed: (role) => role === 'ADMIN', whoCan: 'the administrator' },
  { key: 'event-log', label: 'Event log', allowed: (role) => role === 'ADMIN', whoCan: 'the administrator' },
  { key: 'measurements', label: 'Measurements', allowed: () => true, whoCan: 'everyone' },
]

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
 * Every key the URL may carry, in the hash or in `?screen=`: the current
 * view names plus the names earlier links used, so an old link still opens
 * the view that now holds that content.
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
  return KEY_ALIASES[key] ?? null
}

/** The route a hash selects; an empty or unknown hash is the Hospital view. */
export function routeFromHash(hash: string): RouteKey {
  return routeFromKey(hash) ?? 'hospital'
}
