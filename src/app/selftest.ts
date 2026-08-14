import goldenBillJson from './data/golden-bill.json'
import type { Engine } from '../core/engine'
import type { AppState } from './store'
import { replay, snapshotFromDb, snapshotsEqual } from '../core/replay'

/**
 * In-page selftest, the headless-Chrome verification hook for Task 11. Runs
 * only when `location.search` has `selftest=1`, after boot has produced a
 * booted engine, and writes the result into `document.title` — that's the
 * one thing a headless `--dump-dom` capture can trivially assert on.
 *
 * Three checks, run in order against the live, restored `Engine`:
 *   1. golden invoice  — engine.invoiceFor(1) matches golden-bill.json
 *      (admission 1, the seed's lowest-id refund invoice — see Task 10).
 *   2. C1 probe         — a raw double-insert of an ACTIVE admission onto
 *      an already-occupied bed must throw a UNIQUE/constraint error.
 *   3. replay spot-check — replay(all events, beds) folds to the same
 *      Snapshot as the live db (C2), on the small restored demo db.
 */

interface GoldenBill {
  admissionId: number
  nights: number
  roomRatePaise: number
  roomTotalPaise: number
  extrasTotalPaise: number
  depositPaise: number
  balancePaise: number
  refundPaise: number
}

const golden = goldenBillJson as GoldenBill

type MoneyField =
  | 'roomRatePaise'
  | 'roomTotalPaise'
  | 'extrasTotalPaise'
  | 'depositPaise'
  | 'balancePaise'
  | 'refundPaise'

const GOLDEN_MONEY_FIELDS: MoneyField[] = [
  'roomRatePaise',
  'roomTotalPaise',
  'extrasTotalPaise',
  'depositPaise',
  'balancePaise',
  'refundPaise',
]

function checkGoldenInvoice(engine: Engine): string | undefined {
  const invoice = engine.invoiceFor(golden.admissionId)
  if (!invoice) {
    return `invoiceFor(${golden.admissionId}) returned no invoice`
  }
  if (invoice.nights !== golden.nights) {
    return `nights mismatch: expected ${golden.nights}, got ${invoice.nights}`
  }
  for (const field of GOLDEN_MONEY_FIELDS) {
    const actual = invoice[field]
    const expected = golden[field]
    if (actual !== expected) {
      return `${field} mismatch: expected ${expected}, got ${actual}`
    }
  }
  return undefined
}

function checkC1Probe(engine: Engine): string | undefined {
  const occupiedBed = engine.beds().find((b) => b.occupied)
  if (!occupiedBed) {
    return 'no occupied bed found to probe against'
  }
  const activePatientIds = new Set(engine.admissionsActive().map((a) => a.patientId))
  const freePatient = engine.patients().find((p) => !activePatientIds.has(p.id))
  if (!freePatient) {
    return 'no patient without an active admission available for the probe insert'
  }

  try {
    engine.db.run(
      `INSERT INTO admissions (patient_id,bed_id,diagnosis,deposit_paise,status,admitted_at)
       VALUES (?,?,?,?,'ACTIVE',?)`,
      [freePatient.id, occupiedBed.id, 'selftest C1 probe', 0, '2026-08-01T00:00:00.000Z'],
    )
    return 'double-insert onto an occupied bed did not throw'
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return /UNIQUE|constraint/i.test(message) ? undefined : `unexpected error: ${message}`
  }
}

function checkReplaySpot(engine: Engine): string | undefined {
  const db = engine.db
  const beds = db
    .all<{ id: number; label: string; ward: string; rate_paise: number }>(
      `SELECT id, label, ward, rate_paise FROM beds ORDER BY id`,
    )
    .map((r) => ({ id: r.id, label: r.label, ward: r.ward, ratePaise: r.rate_paise }))
  const events = engine.eventsLog()

  const replayed = replay(events, beds)
  const live = snapshotFromDb(db)
  const { equal, diff } = snapshotsEqual(replayed, live)
  return equal ? undefined : `replay diverged from live db (${diff.length} mismatch): ${diff.slice(0, 3).join('; ')}`
}

const CHECKS: { name: string; run: (engine: Engine) => string | undefined }[] = [
  { name: 'golden invoice', run: checkGoldenInvoice },
  { name: 'C1 probe', run: checkC1Probe },
  { name: 'replay spot-check', run: checkReplaySpot },
]

function runSelftest(engine: Engine): void {
  let passed = 0
  for (const check of CHECKS) {
    const failure = check.run(engine)
    if (failure === undefined) {
      passed++
      continue
    }
    document.title = `WARDOS-SELFTEST: FAIL ${check.name}: ${failure}`
    return
  }
  document.title = `WARDOS-SELFTEST: PASS ${passed}/${CHECKS.length}`
}

/** Called once, after `store.boot()` settles. No-op unless `?selftest=1`. */
export function maybeRunSelftest(state: AppState): void {
  const params = new URLSearchParams(location.search)
  if (params.get('selftest') !== '1') return

  if (!state.engine) {
    document.title = `WARDOS-SELFTEST: FAIL boot produced no engine: ${state.error ?? 'unknown error'}`
    return
  }
  runSelftest(state.engine)
}
