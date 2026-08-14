import { useEffect, useSyncExternalStore } from 'react'
import { store } from './store'
import { maybeRunSelftest } from './selftest'
import Login from './Login'
import './styles/base.css'

export default function App() {
  const state = useSyncExternalStore(store.subscribe, store.get)

  useEffect(() => {
    void store.boot().then(() => {
      maybeRunSelftest(store.get())
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
  const census = engine.census()

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>WardOS</h1>
        <div className="session-info">
          <span>
            {actor.username} · {actor.role}
          </span>
          <button type="button" onClick={() => store.logout()}>
            Log out
          </button>
        </div>
      </header>
      <p className="census-line">
        {census.patients} patients · {census.active} active admissions · {census.bedsFree}/
        {census.bedsTotal} beds free
      </p>
    </main>
  )
}
