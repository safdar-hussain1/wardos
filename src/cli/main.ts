/**
 * wardos — the WardOS operations CLI.
 *
 * Run via `node bin/wardos.mjs <command> [args] [--db <path>]`.
 * `bin/wardos.mjs` is a thin loader that spawns this repo's own vite-node
 * (the same pattern `scripts/run-benchmark.mjs` already uses — see that
 * file's header for the full rationale) on this file, so the CLI can import
 * the project's extensionless, unbundled ES module sources (src/core,
 * src/db, src/seed) exactly as Vitest and the benchmark do, without a
 * second, parallel `tsc` build pipeline.
 *
 * Commands (all operate on `data/hospital.db` by default; `--db <path>`
 * overrides):
 *   seed          seed a fresh hospital, write it to the db path, print a summary
 *   beds          table of all beds and their occupancy state
 *   report        census, revenue by charge kind, payroll total, outstanding balance
 *   bill <id>     itemized invoice for an admission — frozen if DISCHARGED, a
 *                 live preview (as of the fixed clock anchor) if ACTIVE
 *   verify        C2 replay-equivalence check of the db file; PASS/FAIL + diff
 *   export        write src/app/data/summary.json for the site's results section
 *   snapshot      seed a fresh hospital and write it to public/demo.db — the
 *                 committed artifact the browser app boots from (Task 11,
 *                 Ruling A). Ignores --db; always writes public/demo.db.
 *                 Re-run this whenever src/seed changes
 *                 (tests/demo-snapshot.test.ts fails loudly otherwise).
 *
 * Exit codes: 0 success; 1 runtime error or `verify` FAIL; 2 usage error
 * (missing or unknown command). Every command sets `process.exitCode`
 * rather than calling `process.exit()` mid-stream, so buffered stdout is
 * never truncated.
 *
 * No wall clock, ever: every command that needs "now" (the live `bill`
 * preview of an ACTIVE admission, in particular) uses a `FixedClock` pinned
 * to `ANCHOR_ISO`, not `Date.now()`/`new Date()` — see tests/no-wallclock.test.ts,
 * which scans this file along with src/core, src/db, src/seed, src/naive,
 * src/bench for exactly that.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Db } from '../db/database'
import { Engine } from '../core/engine'
import { FixedClock, ANCHOR_ISO } from '../core/clock'
import { formatINR } from '../core/money'
import type { ComputedInvoice, ChargeKind } from '../core/billing'
import { seedHospital } from '../seed/seed'
import { DEMO_ACCOUNTS } from '../seed/facility'
import { replay, snapshotFromDb, snapshotsEqual } from '../core/replay'
import type { BedRow } from '../core/replay'

const DEFAULT_DB_PATH = 'data/hospital.db'
const SUMMARY_PATH = join('src', 'app', 'data', 'summary.json')
const DEMO_SNAPSHOT_PATH = join('public', 'demo.db')

// Fixed order every command uses when printing/aggregating by charge kind —
// matches the CHECK constraint on charges.kind (src/db/schema.sql) and
// seed.ts's own CHARGE_KINDS — so output never depends on SQL GROUP BY's
// unspecified row order.
const CHARGE_KIND_ORDER: ChargeKind[] = ['PROCEDURE', 'PHARMACY', 'CONSULTATION', 'TRANSPORT']

// Fixed order for payroll-by-role aggregation — mirrors staff.ts's `type` enum.
const STAFF_TYPE_ORDER = ['DOCTOR', 'NURSE', 'TECHNICIAN', 'DRIVER', 'ADMIN'] as const

/** A clean, user-facing error: printed without a stack trace, exits 1. */
class CliError extends Error {}

// ---------------------------------------------------------------------
// argv parsing
// ---------------------------------------------------------------------

interface ParsedArgs {
  command: string | undefined
  dbPath: string
  positional: string[]
}

function parseArgs(argv: string[]): ParsedArgs {
  let dbPath = DEFAULT_DB_PATH
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--db') {
      const value = argv[i + 1]
      if (value === undefined) {
        throw new CliError('--db requires a path argument')
      }
      dbPath = value
      i++
    } else {
      positional.push(arg)
    }
  }
  const [command, ...rest] = positional
  return { command, dbPath, positional: rest }
}

function printUsage(): void {
  console.log(`wardos — the WardOS operations CLI

Usage: wardos <command> [args] [--db <path>]

Commands:
  seed              seed a fresh hospital database, write it, print a summary
  beds              list all beds and their occupancy state
  report            print census, revenue by charge kind, payroll, outstanding balance
  bill <id>         print the itemized invoice for admission <id>
  verify            check replay(events) matches the live database, exit 1 on mismatch
  export            write src/app/data/summary.json for the site's results section
  snapshot          seed a fresh hospital and write it to public/demo.db

Options:
  --db <path>       database file to read/write (default: ${DEFAULT_DB_PATH})`)
}

// ---------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------

async function loadDb(dbPath: string): Promise<Db> {
  if (!existsSync(dbPath)) {
    throw new CliError(`no database found at ${dbPath} — run 'wardos seed --db ${dbPath}' first`)
  }
  const bytes = readFileSync(dbPath)
  return Db.restore(bytes)
}

function loadBedRows(db: Db): BedRow[] {
  return db
    .all<{ id: number; label: string; ward: string; rate_paise: number }>(
      `SELECT id, label, ward, rate_paise FROM beds ORDER BY id`,
    )
    .map((r) => ({ id: r.id, label: r.label, ward: r.ward, ratePaise: r.rate_paise }))
}

/**
 * Sums `charges.amount_paise` by kind, restricted to charges on admissions
 * that have been invoiced (i.e. discharged) — a join against `invoices`,
 * not every charge ever raised. Charges on a still-ACTIVE admission are
 * accrued, not yet realized revenue.
 */
function revenueByChargeKind(db: Db): Map<ChargeKind, number> {
  const rows = db.all<{ kind: ChargeKind; total: number }>(
    `SELECT c.kind AS kind, SUM(c.amount_paise) AS total
     FROM charges c
     JOIN invoices i ON i.admission_id = c.admission_id
     GROUP BY c.kind`,
  )
  const map = new Map<ChargeKind, number>(CHARGE_KIND_ORDER.map((k) => [k, 0]))
  for (const r of rows) {
    map.set(r.kind, r.total)
  }
  return map
}

/** Sum of positive unpaid balances. Invoices are frozen at discharge, so
 * `balance_paise > 0` is the honest definition of "still owed". */
function outstandingTotal(db: Db): number {
  return (
    db.get<{ total: number | null }>(`SELECT SUM(balance_paise) AS total FROM invoices WHERE balance_paise > 0`)
      ?.total ?? 0
  )
}

function refundCount(db: Db): number {
  return db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM invoices WHERE balance_paise < 0`)?.n ?? 0
}

function occupancyByWard(
  engine: Engine,
): { ward: string; bedsTotal: number; occupied: number; free: number; ratePaise: number }[] {
  const beds = engine.beds()
  const byWard = new Map<string, { bedsTotal: number; occupied: number; ratePaise: number }>()
  for (const b of beds) {
    const cur = byWard.get(b.ward) ?? { bedsTotal: 0, occupied: 0, ratePaise: b.ratePaise }
    cur.bedsTotal += 1
    if (b.occupied) cur.occupied += 1
    byWard.set(b.ward, cur)
  }
  return [...byWard.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ward, v]) => ({
      ward,
      bedsTotal: v.bedsTotal,
      occupied: v.occupied,
      free: v.bedsTotal - v.occupied,
      ratePaise: v.ratePaise,
    }))
}

function payrollByRole(engine: Engine): { role: string; count: number; totalPaise: number }[] {
  const payroll = engine.payroll()
  const byType = new Map<string, { count: number; totalPaise: number }>()
  for (const row of payroll.rows) {
    const cur = byType.get(row.type) ?? { count: 0, totalPaise: 0 }
    cur.count += 1
    cur.totalPaise += row.monthlyPaise
    byType.set(row.type, cur)
  }
  return STAFF_TYPE_ORDER.filter((t) => byType.has(t)).map((role) => {
    const v = byType.get(role)
    // filter above guarantees a hit, but keep the type checker honest.
    if (!v) throw new Error(`payrollByRole: unreachable — ${role} filtered but missing`)
    return { role, count: v.count, totalPaise: v.totalPaise }
  })
}

// ---------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------

async function cmdSeed(dbPath: string): Promise<void> {
  const { db, engine } = await seedHospital()

  const dir = dirname(dbPath)
  if (dir !== '.') mkdirSync(dir, { recursive: true })
  writeFileSync(dbPath, db.serialize())

  const census = engine.census()
  console.log(`Seeded database written to ${dbPath}`)
  console.log('')
  console.log('Census:')
  console.log(`  Patients: ${census.patients}`)
  console.log(`  Active admissions: ${census.active}`)
  console.log(`  Beds: ${census.bedsTotal} total (${census.bedsFree} free)`)
  console.log('')
  console.log('Demo accounts:')
  for (const acc of DEMO_ACCOUNTS) {
    console.log(`  ${acc.username.padEnd(12)}${acc.password.padEnd(16)}${acc.role}`)
  }
}

async function cmdBeds(dbPath: string): Promise<void> {
  const db = await loadDb(dbPath)
  const engine = new Engine(db, new FixedClock(ANCHOR_ISO))
  const beds = engine.beds()

  console.log(`Beds (${beds.length} total)`)
  console.log('')
  console.log(
    `${'ID'.padEnd(5)}${'Label'.padEnd(8)}${'Ward'.padEnd(9)}${'Rate'.padEnd(14)}${'Status'.padEnd(11)}Patient`,
  )
  for (const b of beds) {
    const idCol = String(b.id).padEnd(5)
    const labelCol = b.label.padEnd(8)
    const wardCol = b.ward.padEnd(9)
    const rateCol = formatINR(b.ratePaise).padEnd(14)
    const statusCol = (b.occupied ? 'OCCUPIED' : 'FREE').padEnd(11)
    const patientCol = b.occupied ? (b.patientName ?? '') : ''
    console.log(`${idCol}${labelCol}${wardCol}${rateCol}${statusCol}${patientCol}`)
  }
}

async function cmdReport(dbPath: string): Promise<void> {
  const db = await loadDb(dbPath)
  const engine = new Engine(db, new FixedClock(ANCHOR_ISO))

  const census = engine.census()
  const revenue = revenueByChargeKind(db)
  const revenueTotal = [...revenue.values()].reduce((a, b) => a + b, 0)
  const payroll = engine.payroll()
  const outstandingPaise = outstandingTotal(db)

  console.log('Report')
  console.log('')
  console.log('Census:')
  console.log(`  Patients: ${census.patients}`)
  console.log(`  Active admissions: ${census.active}`)
  console.log(`  Beds: ${census.bedsTotal} total (${census.bedsFree} free)`)
  console.log('')
  console.log('Revenue by charge kind:')
  for (const kind of CHARGE_KIND_ORDER) {
    console.log(`  ${kind.padEnd(14)}${formatINR(revenue.get(kind) ?? 0)}`)
  }
  console.log(`  ${'Total'.padEnd(14)}${formatINR(revenueTotal)}`)
  console.log('')
  console.log('Payroll:')
  console.log(`  Total monthly payroll: ${formatINR(payroll.totalPaise)}`)
  console.log('')
  console.log(`Outstanding balance: ${formatINR(outstandingPaise)}`)
}

interface AdmissionHeader {
  id: number
  patient_name: string
  mrn: string
  bed_label: string
  ward: string
  diagnosis: string
  admitted_at: string
  discharged_at: string | null
  status: 'ACTIVE' | 'DISCHARGED'
}

function printInvoice(admission: AdmissionHeader, invoice: ComputedInvoice): void {
  console.log(`Invoice for admission #${admission.id} (${admission.status})`)
  console.log('')
  console.log(`Patient:    ${admission.patient_name} (${admission.mrn})`)
  console.log(`Bed:        ${admission.bed_label} (${admission.ward})`)
  console.log(`Diagnosis:  ${admission.diagnosis}`)
  console.log(`Admitted:   ${admission.admitted_at}`)
  console.log(`Discharged: ${admission.discharged_at ?? '(active)'}`)
  console.log('')
  console.log(`Nights:     ${invoice.nights}`)
  console.log(`Room rate:  ${formatINR(invoice.roomRatePaise)} / night`)
  console.log(`Room total: ${formatINR(invoice.roomTotalPaise)}`)
  console.log('')
  console.log('Charges:')
  if (invoice.lines.length === 0) {
    console.log('  (none)')
  } else {
    for (const line of invoice.lines) {
      console.log(
        `  ${line.kind.padEnd(14)}${line.description.padEnd(34)}${formatINR(line.amountPaise).padStart(14)}`,
      )
    }
  }
  console.log('')
  console.log(`Extras total: ${formatINR(invoice.extrasTotalPaise)}`)
  console.log(`Deposit:      ${formatINR(invoice.depositPaise)}`)
  console.log('')
  if (invoice.isRefund) {
    console.log(`Refund due: ${formatINR(invoice.refundPaise)}`)
  } else {
    console.log(`Balance due: ${formatINR(invoice.balancePaise)}`)
  }
}

async function cmdBill(dbPath: string, positional: string[]): Promise<void> {
  const idArg = positional[0]
  if (idArg === undefined) {
    throw new CliError('bill requires an <admissionId> argument')
  }
  const admissionId = Number(idArg)
  if (!Number.isInteger(admissionId) || admissionId <= 0) {
    throw new CliError(`invalid admission id: ${idArg}`)
  }

  const db = await loadDb(dbPath)
  const engine = new Engine(db, new FixedClock(ANCHOR_ISO))

  const admission = db.get<AdmissionHeader>(
    `SELECT a.id, p.name AS patient_name, p.mrn, b.label AS bed_label, b.ward,
            a.diagnosis, a.admitted_at, a.discharged_at, a.status
     FROM admissions a
     JOIN patients p ON p.id = a.patient_id
     JOIN beds b ON b.id = a.bed_id
     WHERE a.id = ?`,
    [admissionId],
  )
  if (!admission) {
    throw new CliError(`admission ${admissionId} not found`)
  }

  const invoice =
    admission.status === 'DISCHARGED' ? engine.invoiceFor(admissionId) : engine.billPreview(admissionId)
  if (!invoice) {
    throw new CliError(`no invoice found for admission ${admissionId}`)
  }

  printInvoice(admission, invoice)
}

async function cmdVerify(dbPath: string): Promise<void> {
  const db = await loadDb(dbPath)
  const engine = new Engine(db, new FixedClock(ANCHOR_ISO))

  const bedRows = loadBedRows(db)
  const events = engine.eventsLog()
  const snap = replay(events, bedRows)
  const dbSnap = snapshotFromDb(db)
  const { equal, diff } = snapshotsEqual(snap, dbSnap)

  if (equal) {
    console.log(`PASS: replay of ${events.length} events matches the live database exactly.`)
    return
  }

  console.log(
    `FAIL: replay of ${events.length} events diverges from the live database (${diff.length} mismatch${diff.length === 1 ? '' : 'es'}):`,
  )
  for (const line of diff) {
    console.log(`  ${line}`)
  }
  process.exitCode = 1
}

async function cmdExport(dbPath: string): Promise<void> {
  const db = await loadDb(dbPath)
  const engine = new Engine(db, new FixedClock(ANCHOR_ISO))

  const census = engine.census()
  const revenue = revenueByChargeKind(db)
  const payroll = engine.payroll()

  const summary = {
    generatedAtIso: ANCHOR_ISO,
    census,
    occupancyByWard: occupancyByWard(engine),
    revenueByChargeKind: CHARGE_KIND_ORDER.map((kind) => ({ kind, totalPaise: revenue.get(kind) ?? 0 })),
    payrollByRole: { rows: payrollByRole(engine), totalPaise: payroll.totalPaise },
    outstandingPaise: outstandingTotal(db),
    refundCount: refundCount(db),
  }

  mkdirSync(dirname(SUMMARY_PATH), { recursive: true })
  writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2) + '\n', 'utf8')
  console.log(`Wrote ${SUMMARY_PATH}`)
}

async function cmdSnapshot(): Promise<void> {
  const { db, engine } = await seedHospital()

  const dir = dirname(DEMO_SNAPSHOT_PATH)
  if (dir !== '.') mkdirSync(dir, { recursive: true })
  writeFileSync(DEMO_SNAPSHOT_PATH, db.serialize())

  const census = engine.census()
  console.log(`Wrote ${DEMO_SNAPSHOT_PATH}`)
  console.log(
    `Census: ${census.patients} patients, ${census.active} active admissions, ${census.bedsTotal} beds`,
  )
}

// ---------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------

async function main(argv: string[]): Promise<void> {
  const { command, dbPath, positional } = parseArgs(argv)

  switch (command) {
    case 'seed':
      return cmdSeed(dbPath)
    case 'beds':
      return cmdBeds(dbPath)
    case 'report':
      return cmdReport(dbPath)
    case 'bill':
      return cmdBill(dbPath, positional)
    case 'verify':
      return cmdVerify(dbPath)
    case 'export':
      return cmdExport(dbPath)
    case 'snapshot':
      return cmdSnapshot()
    case undefined:
      printUsage()
      process.exitCode = 2
      return
    default:
      console.error(`wardos: unknown command '${command}'\n`)
      printUsage()
      process.exitCode = 2
      return
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`wardos: ${message}`)
  process.exitCode = 1
})
