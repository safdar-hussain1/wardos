import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Db } from '../src/db/database'

/**
 * Exercises the CLI as an external process — `node bin/wardos.mjs …` — the
 * same way a real user (or `npm run` script) would invoke it, rather than
 * importing src/cli/main.ts's internals directly. `--db` always points into
 * a scratch directory under `.superpowers/tmp/` (already git-ignored via
 * the blanket `.superpowers/` rule in .gitignore), never at the real
 * `data/hospital.db`.
 *
 * Seeding takes ~10-15s (it's a real six-month simulation through the real
 * Engine — see src/seed/seed.ts), so it runs exactly once in `beforeAll`
 * and every other test reuses that one seeded db file. `beforeAll` and the
 * one test that re-tampers the db both get a generous timeout to absorb
 * that.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const tmpDir = join(repoRoot, '.superpowers', 'tmp', 'cli-test')
const dbPath = join(tmpDir, 'hospital.db')

function run(...args: string[]): string {
  return execFileSync('node', ['bin/wardos.mjs', ...args], { cwd: repoRoot, encoding: 'utf8' })
}

function runExpectFailure(...args: string[]): { status: number; stdout: string } {
  try {
    const stdout = execFileSync('node', ['bin/wardos.mjs', ...args], { cwd: repoRoot, encoding: 'utf8' })
    return { status: 0, stdout }
  } catch (err) {
    const e = err as { status: number; stdout: string }
    return { status: e.status, stdout: e.stdout }
  }
}

describe('wardos CLI', () => {
  let seedOutput = ''

  beforeAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    mkdirSync(tmpDir, { recursive: true })
    seedOutput = run('seed', '--db', dbPath)
  }, 120_000)

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('seed writes the database file and prints a census + demo accounts summary', () => {
    expect(existsSync(dbPath)).toBe(true)
    expect(seedOutput).toContain('Census')
    expect(seedOutput).toContain('Demo accounts')
    expect(seedOutput).toContain('admin')
    expect(seedOutput).toContain('32')
  })

  it('beds prints a table of all 32 beds', () => {
    const out = run('beds', '--db', dbPath)
    expect(out).toContain('Beds')
    expect(out).toContain('32')
    expect(out).toContain('GENERAL')
  })

  it('report prints census, revenue by charge kind, payroll, and outstanding balance', () => {
    const out = run('report', '--db', dbPath)
    expect(out).toContain('Census')
    expect(out).toContain('Revenue by charge kind')
    expect(out).toContain('Payroll')
    expect(out).toContain('Outstanding balance')
    expect(out).toContain('32')
  })

  it('bill 1 matches the frozen golden invoice byte-for-byte (admission 1: the lowest-id refund in the seed)', () => {
    const out = run('bill', '1', '--db', dbPath)
    const golden = readFileSync(join(repoRoot, 'tests/golden/bill-1.txt'), 'utf8')
    expect(out).toBe(golden)
    expect(out).toContain('Refund due: ₹13,340.75')
  })

  it('verify PASSes (exit 0) on a freshly seeded, untampered database', () => {
    const out = run('verify', '--db', dbPath)
    expect(out).toContain('PASS')
  })

  it("verify FAILs (exit 1) and names the mismatch after a raw UPDATE bypasses the event log (tamper detection)", async () => {
    const bytes = readFileSync(dbPath)
    const db = await Db.restore(bytes)
    db.run(`UPDATE admissions SET deposit_paise = deposit_paise + 100 WHERE id = 1`)
    writeFileSync(dbPath, db.serialize())

    const { status, stdout } = runExpectFailure('verify', '--db', dbPath)
    expect(status).toBe(1)
    expect(stdout).toContain('FAIL')
    expect(stdout).toContain('admissions[1]')
    expect(stdout).toContain('depositPaise')
  })
})
