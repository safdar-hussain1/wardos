import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { seedHospital } from '../src/seed/seed'

/**
 * Ruling A (Task 11): `public/demo.db` is a committed artifact — the browser
 * boots by fetching it, never by re-running the six-month seed in-page. This
 * guards that artifact against seed drift: if src/seed changes without
 * regenerating the snapshot (`node bin/wardos.mjs snapshot`), this fails
 * loudly instead of silently shipping a stale demo.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('public/demo.db snapshot', () => {
  it('SHA-256 matches a freshly seeded hospital (regenerate via `node bin/wardos.mjs snapshot` if this fails)', async () => {
    const committedBytes = readFileSync(join(repoRoot, 'public', 'demo.db'))
    const { db } = await seedHospital()

    expect(sha256(committedBytes)).toBe(sha256(db.serialize()))
  }, 30_000)
})
