import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react'
import { store } from './store'
import type { Actor } from '../core/engine'
import type { Role } from '../core/permissions'
import { maybeRunSelftest } from './selftest'
import { DEMO_ACCOUNTS } from '../seed/facility'
import Login from './Login'
import Shell from './screens/Shell'
import Hospital from './screens/Hospital'
import BillingDesk from './screens/BillingDesk'
import Payroll from './screens/Payroll'
import Ambulances from './screens/Ambulances'
import AuditTrail from './screens/AuditTrail'
import Measurements from './screens/Measurements'
import { useHashRoute } from './hooks'
import { HOW_IT_WORKS_ANCHOR, routeDef, routeFromKey } from './routes'
import type { RouteKey } from './routes'
import { preferredRole, setPreferredRole, signInAs, subscribePreferredRole, switchRole } from './session'
import { ROLE_LABELS, ROLE_ORDER } from './labels'
import { Icon } from './icons'
import './styles/tokens.css'
import './styles/components.css'
import './styles/shell.css'
import './styles/hospital.css'
import './styles/screens.css'

/**
 * `?as=reception` (a role name, any case, or a demo username such as dr.rao)
 * opens the demo on shift as that account. Without it the demo opens as the
 * administrator, who can see every view. The accounts are public demo
 * accounts; signing in still checks the password against its bcrypt hash.
 */
function roleFromUrl(): Role | null {
  const as = new URLSearchParams(window.location.search).get('as')
  if (!as) return null
  const account = DEMO_ACCOUNTS.find((a) => a.role.toLowerCase() === as.toLowerCase() || a.username === as)
  return account ? (account.role as Role) : null
}

/**
 * `?screen=<view>` opens a view on first load, for links made before the
 * views were addressed by the hash (old names map to the view that now holds
 * that content, e.g. `time-machine` to the Hospital view).
 */
function applyScreenParam(): void {
  const screen = new URLSearchParams(window.location.search).get('screen')
  if (screen === null || window.location.hash) return
  const route = routeFromKey(screen)
  if (!route) return
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${route}`)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

/** The booting view: the same markup index.html ships inside #root, so the first paint never jumps. */
export function BootScreen() {
  return (
    <div className="boot">
      <div className="boot__sign">
        <p className="boot__brand">
          <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="1" y="1" width="22" height="22" rx="6" fill="#ffffff" />
            <path d="M10 5.5h4v4.5H18.5v4H14v4.5h-4V14H5.5v-4H10z" fill="#14233f" />
          </svg>
          WardOS
        </p>
        <h1 className="boot__title">A whole hospital, running in this browser tab.</h1>
        <p className="boot__lead">
          WardOS runs a 32-bed hospital on a real SQLite database inside the page: admissions, bills, ambulances
          and staff pay, with six months of history behind them. Nothing you do here leaves your device.
        </p>
        <p className="boot__status">Opening the hospital database…</p>
      </div>
    </div>
  )
}

function LockedView({ route, actor }: { route: RouteKey; actor: Actor }) {
  const def = routeDef(route)
  const allowed = ROLE_ORDER.filter((r) => def.allowed(r))
  return (
    <section className="lockedview" aria-labelledby="locked-title">
      <span className="lockedview__icon" aria-hidden="true">
        <Icon name="lock" size={28} />
      </span>
      <h1 id="locked-title">{def.label} is not open to {ROLE_LABELS[actor.role].toLowerCase()}</h1>
      <p>
        Only {def.whoCan} can open this view. The engine enforces the same rule on every command, so the view
        being hidden is a courtesy, not the protection.
      </p>
      <div className="lockedview__actions">
        {allowed.map((role) => (
          <button key={role} type="button" className="button" onClick={() => switchRole(role)}>
            Switch to {ROLE_LABELS[role].toLowerCase()}
          </button>
        ))}
      </div>
    </section>
  )
}

export default function App() {
  const state = useSyncExternalStore(store.subscribe, store.get)
  const preferred = useSyncExternalStore(subscribePreferredRole, preferredRole)
  const { route, hash } = useHashRoute()

  useEffect(() => {
    setPreferredRole(roleFromUrl() ?? 'ADMIN')
    applyScreenParam()
    void store.boot().then(() => maybeRunSelftest(store.get()))
  }, [])

  // Stay on shift: whenever the database is open and nobody is signed in
  // (first load, or after "Reset the demo"), sign back in as the preferred
  // role. After an explicit sign-out there is no preferred role, so the
  // sign-in screen shows instead.
  useEffect(() => {
    if (state.status === 'login' && state.engine && state.error === undefined && preferred !== null) {
      signInAs(preferred)
    }
  }, [state, preferred])

  // A new view starts at its top; "How it works" scrolls to its section.
  useLayoutEffect(() => {
    if (state.status !== 'ready') return
    if (hash === `#${HOW_IT_WORKS_ANCHOR}`) {
      document.getElementById(HOW_IT_WORKS_ANCHOR)?.scrollIntoView({ block: 'start' })
    } else {
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
  }, [hash, state.status])

  if (state.status === 'booting' || (state.status === 'login' && state.engine && preferred !== null && !state.error)) {
    return <BootScreen />
  }

  if (state.status === 'login' || !state.engine || !state.actor) {
    return <Login error={state.error} />
  }

  const { engine, actor } = state
  const allowed = routeDef(route).allowed(actor.role)

  return (
    <Shell actor={actor} route={route}>
      {!allowed && <LockedView route={route} actor={actor} />}
      {allowed && route === 'hospital' && <Hospital engine={engine} actor={actor} />}
      {allowed && route === 'bills' && <BillingDesk engine={engine} actor={actor} />}
      {allowed && route === 'ambulances' && <Ambulances engine={engine} actor={actor} />}
      {allowed && route === 'staff' && <Payroll engine={engine} actor={actor} />}
      {allowed && route === 'event-log' && <AuditTrail engine={engine} actor={actor} />}
      {allowed && route === 'measurements' && <Measurements />}
    </Shell>
  )
}

