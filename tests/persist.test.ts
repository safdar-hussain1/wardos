import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Persistor } from '../src/app/persist'
import type { KV } from '../src/app/persist'
import { Db } from '../src/db/database'

/**
 * Persistor debounces writes to an injected KV — no real IndexedDB needed
 * for these tests. A tiny in-memory fake stands in for browserKV().
 */
function fakeKV(): KV {
  const store = new Map<string, Uint8Array>()
  return {
    async get(k: string) {
      return store.get(k)
    },
    async set(k: string, v: Uint8Array) {
      store.set(k, v)
    },
    async del(k: string) {
      store.delete(k)
    },
  }
}

describe('Persistor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces two schedule() calls within 100ms into exactly one kv.set', async () => {
    const kv = fakeKV()
    const setSpy = vi.spyOn(kv, 'set')
    const persistor = new Persistor(kv)
    const db = await Db.fresh()

    persistor.schedule(db)
    await vi.advanceTimersByTimeAsync(100)
    persistor.schedule(db)
    await vi.advanceTimersByTimeAsync(600)

    expect(setSpy).toHaveBeenCalledTimes(1)
  })

  it('load() round-trips the exact bytes written by schedule()', async () => {
    const kv = fakeKV()
    const persistor = new Persistor(kv)
    const db = await Db.fresh()
    db.run(`INSERT INTO beds (label, ward, rate_paise) VALUES ('T-01','TWIN',280000)`)

    persistor.schedule(db)
    await vi.advanceTimersByTimeAsync(600)

    const loaded = await persistor.load()
    expect(loaded).toBeDefined()
    expect(Array.from(loaded as Uint8Array)).toEqual(Array.from(db.serialize()))
  })

  it('load() returns undefined when nothing has ever been persisted', async () => {
    const kv = fakeKV()
    const persistor = new Persistor(kv)
    expect(await persistor.load()).toBeUndefined()
  })

  it('reset() cancels a pending debounced write and clears any persisted bytes', async () => {
    const kv = fakeKV()
    const persistor = new Persistor(kv)
    const db = await Db.fresh()

    persistor.schedule(db)
    await persistor.reset()
    await vi.advanceTimersByTimeAsync(600)

    expect(await persistor.load()).toBeUndefined()
  })

  it('flush() writes the latest pending bytes immediately and cancels the debounce (no second write when timers run)', async () => {
    const kv = fakeKV()
    const setSpy = vi.spyOn(kv, 'set')
    const persistor = new Persistor(kv)
    const db = await Db.fresh()

    persistor.schedule(db)
    // mutate after schedule() but before flush() — flush must write the
    // LATEST bytes (a fresh db.serialize() call), not whatever was captured
    // at schedule()-time.
    db.run(`INSERT INTO beds (label, ward, rate_paise) VALUES ('T-01','TWIN',280000)`)
    persistor.flush()

    expect(setSpy).toHaveBeenCalledTimes(1)
    const loaded = await persistor.load()
    expect(Array.from(loaded as Uint8Array)).toEqual(Array.from(db.serialize()))

    await vi.advanceTimersByTimeAsync(600)
    expect(setSpy).toHaveBeenCalledTimes(1)
  })

  it('flush() is a no-op when nothing is pending', async () => {
    const kv = fakeKV()
    const setSpy = vi.spyOn(kv, 'set')
    const persistor = new Persistor(kv)

    persistor.flush()

    expect(setSpy).not.toHaveBeenCalled()
  })
})
