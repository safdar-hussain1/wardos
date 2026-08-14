import type { Db } from '../db/database'
import type { ChargeKind } from '../core/billing'
import { computeInvoice } from '../core/billing'

/**
 * The `wardos` row of the benchmark report is asserted by running real SQL
 * (and the real `computeInvoice`) against the seeded db, not assumed to be
 * zero. These probes are exported so both `runBenchmark` and the test suite
 * can call them directly — the test suite proves the probes actually run
 * and return 0, rather than trusting a hardcoded constant.
 */

/**
 * Recomputes every discharged admission's invoice from its stored charges
 * via the real `computeInvoice`, and compares against the stored
 * `invoices.balance_paise`. Expected: 0 (wardos never gets its own math
 * wrong).
 */
export function probeInvoicesWrong(db: Db): number {
  const admissions = db.all<{
    id: number
    admitted_at: string
    discharged_at: string | null
    deposit_paise: number
    bed_id: number
  }>(`SELECT id, admitted_at, discharged_at, deposit_paise, bed_id FROM admissions WHERE status = 'DISCHARGED'`)

  if (admissions.length === 0) {
    // A probe that silently returns 0 because it examined nothing is
    // indistinguishable from one that actually verified everything is
    // correct — that's not an assertion, it's a tautology. Fail loudly
    // instead of reporting a vacuous "0 wrong".
    throw new Error('probeInvoicesWrong: found zero discharged admissions to check — the probe examined nothing')
  }

  let wrong = 0
  for (const admission of admissions) {
    const bed = db.get<{ rate_paise: number }>(`SELECT rate_paise FROM beds WHERE id = ?`, [admission.bed_id])
    if (!bed || admission.discharged_at === null) {
      wrong++ // missing data for a discharged admission is itself a wardos bug
      continue
    }

    const chargeRows = db.all<{ kind: ChargeKind; description: string; amount_paise: number }>(
      `SELECT kind, description, amount_paise FROM charges WHERE admission_id = ? ORDER BY id`,
      [admission.id],
    )
    const recomputed = computeInvoice({
      admittedAtIso: admission.admitted_at,
      dischargedAtIso: admission.discharged_at,
      roomRatePaise: bed.rate_paise,
      lines: chargeRows.map((r) => ({ kind: r.kind, description: r.description, amountPaise: r.amount_paise })),
      depositPaise: admission.deposit_paise,
    })

    const stored = db.get<{ balance_paise: number }>(`SELECT balance_paise FROM invoices WHERE admission_id = ?`, [
      admission.id,
    ])
    if (!stored || recomputed.balancePaise !== stored.balance_paise) {
      wrong++
    }
  }
  return wrong
}

/**
 * Counts beds carrying more than one ACTIVE admission — the SQL-level
 * expression of "two patients double-booked into the same bed". Expected:
 * 0 (the `uq_active_bed` partial unique index in schema.sql makes this
 * impossible by construction).
 */
export function probeDoubleBookings(db: Db): number {
  const row = db.get<{ n: number }>(`
    SELECT COUNT(*) AS n
    FROM admissions a
    JOIN admissions b ON a.bed_id = b.bed_id AND a.id < b.id AND a.status = 'ACTIVE' AND b.status = 'ACTIVE'
  `)
  return row?.n ?? 0
}

/**
 * Occupancy in wardos is *derived* from the admissions table (a bed is
 * occupied iff it has an ACTIVE admission) — there is no separate flag
 * column to drift. This probes that the derived occupancy is itself
 * internally consistent (no bed shows more than one ACTIVE admission),
 * i.e. there is nothing that *could* drift. Expected: 0.
 */
export function probeBedsDrifted(db: Db): number {
  const row = db.get<{ n: number }>(`
    SELECT COUNT(*) AS n FROM (
      SELECT bed_id, COUNT(*) AS active_count
      FROM admissions
      WHERE status = 'ACTIVE'
      GROUP BY bed_id
      HAVING active_count > 1
    )
  `)
  return row?.n ?? 0
}

export interface ProbeCounts {
  invoicesChecked: number
  bedsChecked: number
  admissionsTotal: number
}

/**
 * The row-counts the probes above actually examined — evidence that the
 * `wardos` row's zeros mean "checked, found none" and not "checked
 * nothing, trivially zero". `invoicesChecked` counts every stored invoice
 * (== every discharged admission, the same set `probeInvoicesWrong` walks);
 * `bedsChecked` and `admissionsTotal` count every row in `beds` and
 * `admissions` respectively (active and discharged both), independent of
 * `probeBedsDrifted`'s own filtering.
 */
export function probeCounts(db: Db): ProbeCounts {
  const invoicesChecked = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM invoices`)?.n ?? 0
  const bedsChecked = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM beds`)?.n ?? 0
  const admissionsTotal = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM admissions`)?.n ?? 0
  return { invoicesChecked, bedsChecked, admissionsTotal }
}
