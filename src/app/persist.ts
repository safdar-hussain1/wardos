import type { Db } from '../db/database'

/**
 * Minimal async key-value store the app persists its sqlite bytes through.
 * Kept as a tiny interface (rather than importing IndexedDB types directly
 * everywhere) so tests can inject an in-memory fake instead of driving real
 * IndexedDB — see tests/persist.test.ts.
 */
export interface KV {
  get(k: string): Promise<Uint8Array | undefined>
  set(k: string, v: Uint8Array): Promise<void>
  del(k: string): Promise<void>
}

const IDB_NAME = 'wardos'
const IDB_VERSION = 1
const IDB_STORE = 'kv'

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexedDB.open failed'))
  })
}

/** Hand-rolled IndexedDB-backed KV — no dependency, one object store. */
export function browserKV(): KV {
  return {
    async get(k) {
      const idb = await openIdb()
      return new Promise((resolve, reject) => {
        const req = idb.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(k)
        req.onsuccess = () => resolve(req.result as Uint8Array | undefined)
        req.onerror = () => reject(req.error ?? new Error('KV get failed'))
      })
    },
    async set(k, v) {
      const idb = await openIdb()
      return new Promise((resolve, reject) => {
        const tx = idb.transaction(IDB_STORE, 'readwrite')
        tx.objectStore(IDB_STORE).put(v, k)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('KV set failed'))
      })
    },
    async del(k) {
      const idb = await openIdb()
      return new Promise((resolve, reject) => {
        const tx = idb.transaction(IDB_STORE, 'readwrite')
        tx.objectStore(IDB_STORE).delete(k)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('KV del failed'))
      })
    },
  }
}

const DEFAULT_KEY = 'wardos-db'
const DEBOUNCE_MS = 500

/**
 * Debounces persistence of the app's live sqlite bytes: `schedule()` is
 * called on every dispatched command, but the (relatively expensive)
 * `db.serialize()` + KV write only actually runs once activity settles for
 * `DEBOUNCE_MS` — a burst of commands in quick succession (typical UI
 * interaction) coalesces into a single write.
 */
export class Persistor {
  private readonly kv: KV
  private readonly key: string
  private timer: ReturnType<typeof setTimeout> | undefined
  private pending: Db | undefined

  constructor(kv: KV, key: string = DEFAULT_KEY) {
    this.kv = kv
    this.key = key
  }

  schedule(db: Db): void {
    this.pending = db
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
    }
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.writePending()
    }, DEBOUNCE_MS)
  }

  /**
   * Writes the latest pending db bytes immediately, bypassing the debounce
   * timer — for use on `pagehide`/`visibilitychange`-hidden, so a tab close
   * within the ~500ms debounce window doesn't silently drop the latest
   * writes. No-op if nothing is currently pending.
   *
   * `kv.set` (IndexedDB) is itself async; this fires the put without
   * awaiting it, since a pagehide handler can't usefully await anyway (the
   * page may already be torn down by the time the promise settles) — so
   * this is best-effort. In practice, browsers let an IndexedDB write
   * started during pagehide run to completion.
   */
  flush(): void {
    if (this.timer === undefined || this.pending === undefined) return
    clearTimeout(this.timer)
    this.timer = undefined
    this.writePending()
  }

  private writePending(): void {
    const db = this.pending
    this.pending = undefined
    if (db === undefined) return
    void this.kv.set(this.key, db.serialize())
  }

  load(): Promise<Uint8Array | undefined> {
    return this.kv.get(this.key)
  }

  async reset(): Promise<void> {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.pending = undefined
    await this.kv.del(this.key)
  }
}
