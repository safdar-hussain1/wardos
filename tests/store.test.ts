import { describe, it, expect, vi, afterEach } from 'vitest'
import { createStore } from '../src/app/store'
import type { KV } from '../src/app/persist'
import { Db } from '../src/db/database'

/**
 * store.ts's `boot()`/`resetDemo()` both fetch `demo.db` through the global
 * `fetch`. Stubbing that global (Node 18+ has a real `fetch`, so this is a
 * genuine substitution, not a shim) is the seam the review asked for — no
 * IndexedDB involved, since `createStore` takes an injectable `KV`.
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

function okDemoResponse(bytes: Uint8Array): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    async arrayBuffer() {
      return bytes.buffer
    },
  } as unknown as Response
}

function failingResponse(): Response {
  return { ok: false, status: 500, statusText: 'boom' } as unknown as Response
}

describe('store: resetDemo() error handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('a failed resetDemo() (fetch rejects) surfaces state.error, keeps status sane, and preserves the working engine', async () => {
    // freshBytes.slice() to guarantee byteOffset 0 so `.buffer` is the whole thing.
    const freshBytes = (await Db.fresh()).serialize().slice()
    const fetchMock = vi.fn().mockResolvedValueOnce(okDemoResponse(freshBytes))
    vi.stubGlobal('fetch', fetchMock)

    const testStore = createStore(fakeKV())
    await testStore.boot()
    expect(testStore.get().status).toBe('login')
    const bootedEngine = testStore.get().engine
    expect(bootedEngine).toBeDefined()

    fetchMock.mockRejectedValueOnce(new Error('network down'))
    await testStore.resetDemo()

    const state = testStore.get()
    expect(state.status).toBe('login')
    expect(state.error).toBe('network down')
    expect(state.engine).toBe(bootedEngine)
  })

  it('a failed resetDemo() (non-ok response) also surfaces state.error', async () => {
    const freshBytes = (await Db.fresh()).serialize().slice()
    const fetchMock = vi.fn().mockResolvedValueOnce(okDemoResponse(freshBytes))
    vi.stubGlobal('fetch', fetchMock)

    const testStore = createStore(fakeKV())
    await testStore.boot()

    fetchMock.mockResolvedValueOnce(failingResponse())
    await testStore.resetDemo()

    const state = testStore.get()
    expect(state.status).toBe('login')
    expect(state.error).toBeDefined()
    expect(state.error).toContain('500')
  })

  it('a successful resetDemo() clears any prior error and installs a fresh engine', async () => {
    const freshBytes = (await Db.fresh()).serialize().slice()
    const fetchMock = vi.fn().mockResolvedValue(okDemoResponse(freshBytes))
    vi.stubGlobal('fetch', fetchMock)

    const testStore = createStore(fakeKV())
    await testStore.boot()
    const bootedEngine = testStore.get().engine

    await testStore.resetDemo()

    const state = testStore.get()
    expect(state.status).toBe('login')
    expect(state.error).toBeUndefined()
    expect(state.engine).toBeDefined()
    expect(state.engine).not.toBe(bootedEngine)
  })
})
