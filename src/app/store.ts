import { Db } from '../db/database'
import { Engine } from '../core/engine'
import type { Actor } from '../core/engine'
import { FixedClock, ANCHOR_ISO } from '../core/clock'
import type { KV } from './persist'
import { Persistor, browserKV } from './persist'

/**
 * The app's frozen "today" — see clock.ts. Every Engine constructed by this
 * store (boot, reset) shares this instant; commands advance nothing.
 */
const APP_CLOCK = () => new FixedClock(ANCHOR_ISO)

export interface AppState {
  status: 'booting' | 'login' | 'ready'
  engine?: Engine
  actor?: Actor
  error?: string
}

export interface AppStore {
  get(): AppState
  subscribe(fn: () => void): () => void
  boot(): Promise<void>
  login(u: string, p: string): void
  logout(): void
  dispatch<T>(fn: (e: Engine, a: Actor) => T): T
  resetDemo(): Promise<void>
}

/**
 * Fetches the committed demo snapshot (Ruling A) — a relative URL so it
 * resolves correctly under a GitHub Pages subpath the same way
 * database.ts's wasm loader does.
 */
async function fetchDemoBytes(): Promise<Uint8Array> {
  const url = `${import.meta.env.BASE_URL}demo.db`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`failed to fetch ${url}: ${res.status} ${res.statusText}`)
  }
  return new Uint8Array(await res.arrayBuffer())
}

function isBrowser(): boolean {
  return typeof document !== 'undefined'
}

/**
 * Exported (not just the default `store` singleton below) so tests can
 * construct an isolated instance with an injected `KV` — avoids touching
 * real IndexedDB and lets `fetch` be stubbed per-test without polluting the
 * shared singleton. Defaults to `browserKV()` for real app usage.
 */
export function createStore(kv: KV = browserKV()): AppStore {
  let state: AppState = { status: 'booting' }
  const listeners = new Set<() => void>()
  const persistor = new Persistor(kv)

  // A tab close (or navigation away) within the ~500ms debounce window would
  // otherwise silently drop the latest writes — flush immediately whenever
  // the page is being hidden/torn down. See Persistor.flush()'s doc comment
  // for why this is necessarily best-effort.
  if (isBrowser()) {
    const flushNow = () => persistor.flush()
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushNow()
    })
    window.addEventListener('pagehide', flushNow)
  }

  function get(): AppState {
    return state
  }

  function subscribe(fn: () => void): () => void {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }

  function setState(next: AppState): void {
    state = next
    for (const listener of listeners) listener()
  }

  /**
   * boot() = try Persistor.load() (the user's own persisted state) first;
   * if there is none, fall back to the committed demo.db snapshot — the
   * browser never re-runs the six-month seed itself (Ruling A).
   */
  async function boot(): Promise<void> {
    try {
      const persisted = await persistor.load()
      const bytes = persisted ?? (await fetchDemoBytes())
      const db = await Db.restore(bytes)
      const engine = new Engine(db, APP_CLOCK())
      setState({ status: 'login', engine })
    } catch (err) {
      setState({ status: 'login', error: err instanceof Error ? err.message : String(err) })
    }
  }

  function login(username: string, password: string): void {
    const { engine } = state
    if (!engine) {
      setState({ ...state, status: 'login', error: 'not booted yet' })
      return
    }
    try {
      const actor = engine.authenticate(username, password)
      setState({ status: 'ready', engine, actor })
    } catch {
      setState({ status: 'login', engine, error: 'invalid username or password' })
    }
  }

  function logout(): void {
    const { engine } = state
    setState({ status: 'login', engine })
  }

  /**
   * Engine commands are synchronous, so dispatch is sync too. Every
   * dispatch schedules a debounced persist of the live db and produces a
   * *new* state object (same engine/actor, fresh reference) so
   * useSyncExternalStore-based consumers re-render — the mutation happens
   * inside engine.db, which `state` only holds a reference to.
   */
  function dispatch<T>(fn: (e: Engine, a: Actor) => T): T {
    const { engine, actor } = state
    if (!engine || !actor) {
      throw new Error('dispatch: no active session — must be logged in')
    }
    const result = fn(engine, actor)
    persistor.schedule(engine.db)
    setState({ ...state })
    return result
  }

  /**
   * Wipes the user's persisted state and re-restores from the committed
   * demo.db snapshot — a clean slate identical to a first-ever boot.
   *
   * Mirrors boot()'s error handling: a fetch/restore failure surfaces via
   * state.error rather than throwing out of an event handler. Unlike a
   * fresh boot, there's already a working engine to fall back to here — the
   * previous engine's data may be a little stale relative to the (already
   * wiped) persisted bytes, but keeping it beats leaving the UI with no
   * engine and no way to recover for the rest of the session.
   */
  async function resetDemo(): Promise<void> {
    const previousEngine = state.engine
    try {
      await persistor.reset()
      const db = await Db.restore(await fetchDemoBytes())
      const engine = new Engine(db, APP_CLOCK())
      setState({ status: 'login', engine })
    } catch (err) {
      setState({
        status: 'login',
        engine: previousEngine,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { get, subscribe, boot, login, logout, dispatch, resetDemo }
}

export const store: AppStore = createStore()
