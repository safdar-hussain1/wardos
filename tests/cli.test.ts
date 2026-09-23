import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Db } from '../src/db/database'

/**
 * Exercises the CLI as an external process — `node bin/wardos.mjs …` — the
 * same way a real user (or `npm run` script) would invoke it, rather than
 * importing src/cli/main.ts's internals directly. Every command passes
 * `--db` pointing into a fresh directory under the OS temp dir, removed
 * afterwards — never the CLI's default, the real `data/hospital.db`, and
 * the last test checks that file was left exactly as it was.
 *
 * Seeding is a real six-month simulation through the real Engine (see
 * src/seed/seed.ts), so it runs exactly once in `beforeAll` and every
 * other test reuses that one seeded db file; `beforeAll` gets a generous
 * timeout for slow machines.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const realDbPath = join(repoRoot, 'data', 'hospital.db')
let tmpDir = ''
let dbPath = ''

/** Existence, size and modification time of the real data/hospital.db. */
function realDbState(): string {
  if (!existsSync(realDbPath)) return 'absent'
  const st = statSync(realDbPath)
  return `${st.size}:${st.mtimeMs}`
}

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
  let realDbBefore = ''

  beforeAll(() => {
    realDbBefore = realDbState()
    tmpDir = mkdtempSync(join(tmpdir(), 'wardos-cli-test-'))
    dbPath = join(tmpDir, 'hospital.db')
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

  it('never touches the real data/hospital.db (every command above ran against the temp --db)', () => {
    expect(realDbState()).toBe(realDbBefore)
  })
})
