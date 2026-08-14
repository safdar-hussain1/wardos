import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { store } from './store'
import type { AppState } from './store'
import { maybeRunSelftest } from './selftest'
import { DEMO_ACCOUNTS } from '../seed/facility'
import Login from './Login'
import Shell from './screens/Shell'
import type { ScreenKey } from './screens/Shell'
import CommandDeck from './screens/CommandDeck'
import WardBoard from './screens/WardBoard'
import BillingDesk from './screens/BillingDesk'
import Payroll from './screens/Payroll'
import Ambulances from './screens/Ambulances'
import AuditTrail from './screens/AuditTrail'
import TimeMachine from './screens/TimeMachine'
import About from './screens/About'
import './styles/base.css'

/**
 * Dev/demo convenience hook: `?as=reception` (role name, case-insensitive,
 * or an exact demo username) logs straight in via DEMO_ACCOUNTS once boot
 * has produced an engine. The demo accounts are already public (shown as
 * clickable cards on the Login screen), so skipping the click here is fine
 * — it's what makes headless smoke checks and screenshots practical.
 * No-op unless `?as=` is present, and only ever fires from the ready-after-
 * boot state (never overrides an already-active session).
 */
function maybeAutoLogin(state: AppState): void {
  if (typeof window === 'undefined') return
  if (state.status !== 'login' || !state.engine) return
  const as = new URLSearchParams(window.location.search).get('as')
  if (!as) return
  const account = DEMO_ACCOUNTS.find(
    (a) => a.role.toLowerCase() === as.toLowerCase() || a.username === as,
  )
  if (!account) return
  store.login(account.username, account.password)
}

/**
 * Companion to `?as=`: `?screen=<key>` picks the initial screen for the
 * *first* session of the page load (keys: deck, wards/ward, billing,
 * payroll, ambulances, audit, time-machine, about) — what makes every
 * screen directly reachable for headless screenshots and deep links.
 * Consumed once; later logins land on the command deck as usual.
 */
const SCREEN_URL_KEYS: Record<string, ScreenKey> = {
  deck: 'deck',
  wards: 'ward',
  ward: 'ward',
  billing: 'billing',
  payroll: 'payroll',
  ambulances: 'ambulances',
  audit: 'audit',
  'time-machine': 'time-machine',
  about: 'about',
}

function screenFromUrl(): ScreenKey | null {
  if (typeof window === 'undefined') return null
  const key = new URLSearchParams(window.location.search).get('screen')
  if (key === null) return null
  return SCREEN_URL_KEYS[key.toLowerCase()] ?? null
}

export default function App() {
  const state = useSyncExternalStore(store.subscribe, store.get)
  const [screen, setScreen] = useState<ScreenKey>('deck')
  const urlScreenRef = useRef(screenFromUrl())

  useEffect(() => {
    void store.boot().then(() => {
      maybeRunSelftest(store.get())
      maybeAutoLogin(store.get())
    })
  }, [])

  // A fresh login (including a different role after logout→login) always
  // lands on the command deck — visible to every role, so a new session
  // never lands on a screen the just-logged-in role can't see (the nav
  // guard would still catch it, but this is the better default). The one
  // exception: a `?screen=` deep link steers the first session once.
  const actorId = state.actor?.userId
  useEffect(() => {
    if (actorId === undefined) return
    const fromUrl = urlScreenRef.current
    urlScreenRef.current = null
    setScreen(fromUrl ?? 'deck')
  }, [actorId])

  if (state.status === 'booting') {
    return (
      <main className="app-shell app-shell--centered">
        <p className="status-line">Booting WardOS…</p>
      </main>
    )
  }

  if (state.status === 'login' || !state.engine || !state.actor) {
    return <Login error={state.error} />
  }

  const { engine, actor } = state

  return (
    <Shell actor={actor} activeScreen={screen} onNavigate={setScreen}>
      {screen === 'deck' && <CommandDeck engine={engine} />}
      {screen === 'ward' && <WardBoard engine={engine} actor={actor} />}
      {screen === 'billing' && <BillingDesk engine={engine} actor={actor} />}
      {screen === 'payroll' && <Payroll engine={engine} actor={actor} />}
      {screen === 'ambulances' && <Ambulances engine={engine} actor={actor} />}
      {screen === 'audit' && <AuditTrail engine={engine} actor={actor} />}
      {screen === 'time-machine' && <TimeMachine engine={engine} />}
      {screen === 'about' && <About />}
    </Shell>
  )
}
