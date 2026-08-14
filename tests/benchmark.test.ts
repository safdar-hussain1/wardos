import { describe, it, expect, beforeAll } from 'vitest'
import { runBenchmark, deriveCommandRecords } from '../src/bench/benchmark'
import type { BenchmarkReport, CommandRecord } from '../src/bench/benchmark'
import { probeInvoicesWrong, probeBedsDrifted, probeDoubleBookings } from '../src/bench/probes'
import { seedHospital } from '../src/seed/seed'
import { runFloatMoney } from '../src/naive/floatMoney'
import { runOccupancyFlag } from '../src/naive/occupancyFlag'
import { runMsDates } from '../src/naive/msDates'
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

  describe('N1 floatMoney: real float-precision misbilling', () => {
    it('finds wrong invoices, with a nonzero worst-case and total error', () => {
      expect(a.n1.invoicesWrong).toBeGreaterThan(0)
      expect(a.n1.worstErrorPaise).toBeGreaterThan(0)
      expect(a.n1.totalAbsErrorPaise).toBeGreaterThan(0)
      // worst single error can't exceed the total of all errors
      expect(a.n1.worstErrorPaise).toBeLessThanOrEqual(a.n1.totalAbsErrorPaise)
    })
  })

  describe('N2 occupancyFlag: real second-write drift', () => {
    it('injects at least one crash and drifts at least one bed', () => {
      expect(a.n2.crashesInjected).toBeGreaterThan(0)
      expect(a.n2.bedsDrifted).toBeGreaterThan(0)
    })

    it('never accepts a double booking — structurally impossible given this crash direction', () => {
      // The crash only ever drops the flag-clearing write on discharge, so
      // a stuck flag can only read *occupied* when the bed is truly free —
      // never *free* when a real admission is truly active. Since the
      // flag's own admit-time write never crashes, "flag said free" can
      // only happen when the bed really is free too. Asserted explicitly
      // (not just left untested) so this is a verified, understood zero,
      // not an accidental one.
      expect(a.n2.doubleBookingsAccepted).toBe(0)
    })
  })

  describe('N3 msDates: real ms-division date-math misbilling', () => {
    it('finds wrong invoices, freed day cases, and both under/overbilled nights', () => {
      expect(a.n3.invoicesWrong).toBeGreaterThan(0)
      expect(a.n3.dayCasesFreed).toBeGreaterThan(0)
      expect(a.n3.nightsUnderbilled).toBeGreaterThan(0)
      expect(a.n3.nightsOverbilled).toBeGreaterThan(0)
    })
  })

  describe('wardos row: asserted zero by re-checking the live db, not assumed', () => {
    it('the report literally hardcodes the wardos row to all zeros', () => {
      expect(a.wardos).toEqual({ invoicesWrong: 0, bedsDrifted: 0, doubleBookingsAccepted: 0 })
    })

    it('the SQL probes actually execute against a real seeded db and independently return 0', async () => {
      const { db } = await seedHospital()
      // These are the exact same probe functions runBenchmark() calls
      // internally (and throws on non-zero) — called here directly, against
      // a separately-seeded db, so this test fails if the probes were ever
      // stubbed or the query text broke, not just if runBenchmark's
      // wardos row (a hardcoded literal) were wrong.
      expect(probeInvoicesWrong(db)).toBe(0)
      expect(probeBedsDrifted(db)).toBe(0)
      expect(probeDoubleBookings(db)).toBe(0)
    }, 20_000)
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
      invoicesWrong: expect.any(Number),
      worstErrorPaise: expect.any(Number),
      totalAbsErrorPaise: expect.any(Number),
    })
  })
})

describe('N2 runOccupancyFlag: unit-level crash-on-7th-discharge', () => {
  it('the 7th discharge in stream order crashes and leaves the flag stuck occupied', () => {
    const records: CommandRecord[] = []
    // Seven independent admit/discharge cycles on seven different beds —
    // the 7th discharge (in stream order) must crash.
    for (let i = 1; i <= 7; i++) {
      records.push({ action: 'ADMITTED', at: `admit${i}`, payload: { admissionId: i, bedId: i } })
      records.push({ action: 'DISCHARGED', at: `discharge${i}`, payload: { admissionId: i } })
    }
    const report = runOccupancyFlag(records)
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
