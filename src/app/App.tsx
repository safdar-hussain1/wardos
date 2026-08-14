import { useEffect, useSyncExternalStore } from 'react'
import { store } from './store'
import type { AppState } from './store'
import { maybeRunSelftest } from './selftest'
import { DEMO_ACCOUNTS } from '../seed/facility'
import Login from './Login'
import Shell from './screens/Shell'
import WardBoard from './screens/WardBoard'
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

export default function App() {
  const state = useSyncExternalStore(store.subscribe, store.get)

  useEffect(() => {
    void store.boot().then(() => {
      maybeRunSelftest(store.get())
      maybeAutoLogin(store.get())
    })
  }, [])

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
    <Shell actor={actor}>
      <WardBoard engine={engine} actor={actor} />
    </Shell>
  )
}
