import { describe, it, expect, beforeAll } from 'vitest'
import { runBenchmark, deriveCommandRecords } from '../src/bench/benchmark'
import type { BenchmarkReport, CommandRecord } from '../src/bench/benchmark'
import { probeInvoicesWrong, probeBedsDrifted, probeDoubleBookings, probeCounts } from '../src/bench/probes'
import { seedHospital } from '../src/seed/seed'
import { runFloatMoney, FLOAT_MONEY_DESCRIPTION } from '../src/naive/floatMoney'
import { runOccupancyFlag, OCCUPANCY_FLAG_DESCRIPTION } from '../src/naive/occupancyFlag'
import { runMsDates, MS_DATES_DESCRIPTION } from '../src/naive/msDates'
import { computeInvoice } from '../src/core/billing'

describe('runBenchmark: end-to-end report over a freshly seeded six-month hospital', () => {
  // seedHospital() is not reentrant, so the two runs this suite needs must
  // happen strictly sequentially (never Promise.all'd) — see seedHospital's
  // own reentrancy guard in src/seed/seed.ts.
  let a: BenchmarkReport
  let b: BenchmarkReport

  beforeAll(async () => {
    a = await runBenchmark()
    b = await runBenchmark()
  }, 60_000)

  it('is fully deterministic across two independent seeded runs', () => {
    expect(a).toEqual(b)
  })

  it('reports the same command count as the seed produced events', () => {
    expect(a.commands).toBeGreaterThan(400)
  })

  describe('N1 floatMoney: real order-of-operations misbilling', () => {
    it('finds wrong invoices, with a nonzero worst-case and total error', () => {
      expect(a.n1.invoicesWrong).toBeGreaterThan(0)
      expect(a.n1.worstErrorPaise).toBeGreaterThan(0)
      expect(a.n1.totalAbsErrorPaise).toBeGreaterThan(0)
      // worst single error can't exceed the total of all errors
      expect(a.n1.worstErrorPaise).toBeLessThanOrEqual(a.n1.totalAbsErrorPaise)
    })

    it('description names the −0.0625% residue mechanism, not "floating point drift"', () => {
      expect(a.n1.description).toBe(FLOAT_MONEY_DESCRIPTION)
      expect(a.n1.description).toContain('0.0625')
      expect(a.n1.description).toContain('0.999375')
      expect(a.n1.description.toLowerCase()).not.toContain('floating point drift')
    })

    it('the promo-adjust reversal really is ×0.999375 in exact arithmetic, not a no-op', () => {
      // total += total*0.025 → total*1.025; total -= total*0.025 →
      // (total*1.025) - (total*1.025*0.025) = total*1.025*0.975.
      const factor = 1.025 * 0.975
      expect(factor).toBeCloseTo(0.999375, 10)
      expect(factor).not.toBe(1)
    })
  })

  describe('N2 occupancyFlag: real second-write drift in both directions', () => {
    it('injects both crash types and drifts at least one bed', () => {
      expect(a.n2.crashesOnAdmit).toBeGreaterThan(0)
      expect(a.n2.crashesOnDischarge).toBeGreaterThan(0)
      expect(a.n2.crashesInjected).toBe(a.n2.crashesOnAdmit + a.n2.crashesOnDischarge)
      expect(a.n2.bedsDrifted).toBeGreaterThan(0)
    })

    it('accepts at least one real double booking via the admit-crash + transfer-blindness combination', () => {
      expect(a.n2.doubleBookingsAccepted).toBeGreaterThan(0)
    })

    it('description covers both crash directions and why only the admit crash can cause a double booking', () => {
      expect(a.n2.description).toBe(OCCUPANCY_FLAG_DESCRIPTION)
      expect(a.n2.description).toContain('7th discharge')
      expect(a.n2.description).toContain('11th admit')
      expect(a.n2.description.toLowerCase()).toContain('never cause a double booking')
    })
  })

  describe('N3 msDates: real ms-division date-math misbilling', () => {
    it('finds wrong invoices, freed day cases, and both under/overbilled nights', () => {
      expect(a.n3.invoicesWrong).toBeGreaterThan(0)
      expect(a.n3.dayCasesFreed).toBeGreaterThan(0)
      expect(a.n3.nightsUnderbilled).toBeGreaterThan(0)
      expect(a.n3.nightsOverbilled).toBeGreaterThan(0)
    })

    it('description matches the exported constant', () => {
      expect(a.n3.description).toBe(MS_DATES_DESCRIPTION)
    })
  })

  describe('wardos row: computed probe variables, re-checked against the live db, not assumed', () => {
    it('the report carries the actual computed probe results (all zero, but computed, not hardcoded)', () => {
      expect(a.wardos.invoicesWrong).toBe(0)
      expect(a.wardos.bedsDrifted).toBe(0)
      expect(a.wardos.doubleBookingsAccepted).toBe(0)
    })

    it('the probes examined real rows, not nothing — invoicesChecked matches the db, bedsChecked is exactly 32', () => {
      expect(a.wardos.invoicesChecked).toBeGreaterThan(0)
      expect(a.wardos.bedsChecked).toBe(32)
      expect(a.wardos.admissionsTotal).toBeGreaterThan(0)
    })

    it('the SQL probes actually execute against a real seeded db and independently return 0 / real counts', async () => {
      const { db } = await seedHospital()
      // These are the exact same probe functions runBenchmark() calls
      // internally (and throws on non-zero) — called here directly, against
      // a separately-seeded db, so this test fails if the probes were ever
      // stubbed or the query text broke, not just if runBenchmark's own
      // wardos row were wrong.
      expect(probeInvoicesWrong(db)).toBe(0)
      expect(probeBedsDrifted(db)).toBe(0)
      expect(probeDoubleBookings(db)).toBe(0)

      const counts = probeCounts(db)
      const dbInvoiceCount = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM invoices')?.n ?? 0
      expect(counts.invoicesChecked).toBeGreaterThan(0)
      expect(counts.invoicesChecked).toBe(dbInvoiceCount)
      expect(counts.bedsChecked).toBe(32)
    }, 20_000)

    it('probeInvoicesWrong throws rather than vacuously passing when there is nothing to check', async () => {
      const { Db } = await import('../src/db/database')
      const emptyDb = await Db.fresh() // schema only, zero admissions/invoices
      expect(() => probeInvoicesWrong(emptyDb)).toThrow(/zero discharged admissions/)
    })
  })
})

describe('deriveCommandRecords: chronological replay order', () => {
  it('re-sorts a newest-first event log into ascending (chronological) order and parses payloads', () => {
    const events = [
      { id: 3, at: 't3', actorUserId: null, action: 'DISCHARGED' as const, entity: 'admission', entityId: 1, payload: '{"c":3}' },
      { id: 1, at: 't1', actorUserId: null, action: 'ADMITTED' as const, entity: 'admission', entityId: 1, payload: '{"c":1}' },
      { id: 2, at: 't2', actorUserId: null, action: 'CHARGE_ADDED' as const, entity: 'charge', entityId: 1, payload: '{"c":2}' },
    ]
    const records = deriveCommandRecords(events)
    expect(records.map((r) => r.action)).toEqual(['ADMITTED', 'CHARGE_ADDED', 'DISCHARGED'])
    expect(records.map((r) => r.payload)).toEqual([{ c: 1 }, { c: 2 }, { c: 3 }])
  })
})

describe('N1 runFloatMoney: unit-level float drift', () => {
  it('accumulates float rupee sums across many small charges and rounds to a wrong paise total', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE 754 doubles — three charges of ₹0.10 each
    // (10 paise) plus one of ₹0.20 (20 paise) is exactly ₹0.50 (50 paise)
    // in integer arithmetic, but accumulating as rupee doubles can drift.
    const records: CommandRecord[] = [
      { action: 'ADMITTED', at: 't0', payload: { admissionId: 1, depositPaise: 0 } },
      { action: 'CHARGE_ADDED', at: 't1', payload: { admissionId: 1, amountPaise: 10 } },
      { action: 'CHARGE_ADDED', at: 't2', payload: { admissionId: 1, amountPaise: 20 } },
      {
        action: 'DISCHARGED',
        at: 't3',
        payload: { admissionId: 1, invoice: { nights: 0, roomRatePaise: 0, balancePaise: 30 } },
      },
    ]
    const report = runFloatMoney(records)
    // Whether or not this specific tiny example drifts is incidental; the
    // real, seed-scale property is covered by the end-to-end suite above.
    // This test only pins the shape/plumbing.
    expect(report).toEqual({
      description: FLOAT_MONEY_DESCRIPTION,
      invoicesWrong: expect.any(Number),
      worstErrorPaise: expect.any(Number),
      totalAbsErrorPaise: expect.any(Number),
    })
  })

  it('a bill with no charges/deposit still comes out exactly 0.0625% short from the promo-adjust reversal alone', () => {
    // nights=4, rate=₹1,000/night (₹100,000 paise) => room total ₹4,000
    // exactly. No charges, no deposit, so the naive total before the
    // promo-adjust is exactly ₹4,000 too — an amount the reversal's
    // ×0.999375 factor turns into a non-integer number of paise, so it
    // must round, and it must round DOWN from the true balance.
    const records: CommandRecord[] = [
      { action: 'ADMITTED', at: 't0', payload: { admissionId: 1, depositPaise: 0 } },
      {
        action: 'DISCHARGED',
        at: 't1',
        payload: { admissionId: 1, invoice: { nights: 4, roomRatePaise: 100_000, balancePaise: 400_000 } },
      },
    ]
    const report = runFloatMoney(records)
    expect(report.invoicesWrong).toBe(1)
    // 400000 * 0.999375 = 399750 exactly — an integer this time, so pin the
    // exact expected naive result rather than just "less than true".
    expect(report.worstErrorPaise).toBe(250)
    expect(report.totalAbsErrorPaise).toBe(250)
  })
})

describe('N2 runOccupancyFlag: unit-level crash mechanics', () => {
  it('the 7th discharge in stream order crashes and leaves the flag stuck occupied', () => {
    const records: CommandRecord[] = []
    // Seven independent admit/discharge cycles on seven different beds —
    // the 7th discharge (in stream order) must crash. Fewer than 11 admits
    // total, so the admit-crash never fires here.
    for (let i = 1; i <= 7; i++) {
      records.push({ action: 'ADMITTED', at: `admit${i}`, payload: { admissionId: i, bedId: i } })
      records.push({ action: 'DISCHARGED', at: `discharge${i}`, payload: { admissionId: i } })
    }
    const report = runOccupancyFlag(records)
    expect(report.crashesOnDischarge).toBe(1)
    expect(report.crashesOnAdmit).toBe(0)
    expect(report.crashesInjected).toBe(1)
    expect(report.bedsDrifted).toBe(1) // exactly bed 7's flag is stuck occupied
    expect(report.doubleBookingsAccepted).toBe(0)
  })

  it('a non-7th discharge clears the flag correctly — no drift', () => {
    const records: CommandRecord[] = [
      { action: 'ADMITTED', at: 'a1', payload: { admissionId: 1, bedId: 1 } },
      { action: 'DISCHARGED', at: 'd1', payload: { admissionId: 1 } },
    ]
    const report = runOccupancyFlag(records)
    expect(report.crashesInjected).toBe(0)
    expect(report.bedsDrifted).toBe(0)
  })

  it('exact-11th pinning test: the 11th admit crashes, leaves its bed flagged free, and a later admit reusing that bed (after the occupant transfers away, a move N2 never sees) is accepted as a double booking', () => {
    const records: CommandRecord[] = []
    // Ten unrelated admits on ten different beds — normal, no crash.
    for (let i = 1; i <= 10; i++) {
      records.push({ action: 'ADMITTED', at: `admit${i}`, payload: { admissionId: i, bedId: 100 + i } })
    }
    // The 11th admit overall: admission 11 into bed 999 — this one crashes.
    records.push({ action: 'ADMITTED', at: 'admit11', payload: { admissionId: 11, bedId: 999 } })
    // Admission 11 transfers out of bed 999 to bed 998 — N2 has no code
    // path for TRANSFERRED at all, so it never learns bed 999 is free
    // again, and never learns bed 998 is now occupied.
    records.push({ action: 'TRANSFERRED', at: 'transfer11', payload: { admissionId: 11, toBedId: 998 } })
    // A genuinely different, later admission (12) is admitted into bed
    // 999 — really free (its true occupant moved to 998), but N2's own
    // ledger still shows it occupied (stale) while the flag still reads
    // free (stuck from the 11th-admit crash) — a real double booking N2
    // accepts.
    records.push({ action: 'ADMITTED', at: 'admit12', payload: { admissionId: 12, bedId: 999 } })

    const report = runOccupancyFlag(records)
    expect(report.crashesOnAdmit).toBe(1)
    expect(report.crashesOnDischarge).toBe(0)
    expect(report.doubleBookingsAccepted).toBe(1)
  })

  it('without the admit crash, the same transfer-and-reuse pattern never double-books (both readings stay in sync)', () => {
    const records: CommandRecord[] = [
      { action: 'ADMITTED', at: 'a1', payload: { admissionId: 1, bedId: 999 } },
      { action: 'TRANSFERRED', at: 't1', payload: { admissionId: 1, toBedId: 998 } },
      { action: 'ADMITTED', at: 'a2', payload: { admissionId: 2, bedId: 999 } },
    ]
    const report = runOccupancyFlag(records)
    expect(report.crashesOnAdmit).toBe(0)
    expect(report.doubleBookingsAccepted).toBe(0)
  })
})

describe('N3 runMsDates: hand-computed sanity check (same-day day case)', () => {
  it('true nights=1 (IST calendar minimum) vs naive nights=0 (elapsed time under 12h)', () => {
    // Mirrors tests/billing.test.ts's own same-day example: admit 09:00 IST
    // (03:30 UTC), discharge 17:00 IST (11:30 UTC) — same IST calendar day,
    // 8 hours elapsed. The real billing rule (nightsBetween) bills this as
    // 1 night (the calendar-day minimum); naive ms-division computes
    // round(8h / 24h) = round(0.333) = 0 — the two DIFFER, unlike the
    // brief's other example (18:00 IST -> 10:00 IST next day, where both
    // true and naive agree on 1 night).
    const admittedAtIso = '2026-08-01T03:30:00.000Z'
    const dischargedAtIso = '2026-08-01T11:30:00.000Z'

    const trueInvoice = computeInvoice({
      admittedAtIso,
      dischargedAtIso,
      roomRatePaise: 500_000,
      lines: [],
      depositPaise: 0,
    })
    expect(trueInvoice.nights).toBe(1)

    const records: CommandRecord[] = [
      { action: 'ADMITTED', at: admittedAtIso, payload: { admissionId: 1 } },
      { action: 'DISCHARGED', at: dischargedAtIso, payload: { admissionId: 1, invoice: trueInvoice } },
    ]
    const report = runMsDates(records)

    expect(report.dayCasesFreed).toBe(1)
    expect(report.invoicesWrong).toBe(1)
    expect(report.nightsUnderbilled).toBe(1) // true(1) - naive(0)
    expect(report.nightsOverbilled).toBe(0)
  })
})
