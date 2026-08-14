import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { IST_OFFSET_MS, nightsBetween, computeInvoice } from '../src/core/billing'
import type { InvoiceLine } from '../src/core/billing'

describe('billing', () => {
  describe('IST_OFFSET_MS', () => {
    it('is 5.5 hours in milliseconds', () => {
      expect(IST_OFFSET_MS).toBe(5.5 * 3600_000)
    })
  })

  describe('nightsBetween', () => {
    it('same-day admit/discharge counts as 1 night (day case)', () => {
      // admit 09:00 IST = 03:30 UTC, discharge 17:00 IST = 11:30 UTC, same day
      const nights = nightsBetween('2026-08-01T03:30:00.000Z', '2026-08-01T11:30:00.000Z')
      expect(nights).toBe(1)
    })

    it('evening admit to next-morning discharge counts as 1 night', () => {
      // admit 23:00 IST Aug 1 = 17:30 UTC Aug 1, discharge 07:00 IST Aug 2 = 01:30 UTC Aug 2
      const nights = nightsBetween('2026-08-01T17:30:00.000Z', '2026-08-02T01:30:00.000Z')
      expect(nights).toBe(1)
    })

    it('cross-midnight-UTC trap: same IST calendar day despite crossing UTC midnight', () => {
      // admit 2026-08-01T20:00:00.000Z = Aug 2 01:30 IST
      // discharge 2026-08-02T02:00:00.000Z = Aug 2 07:30 IST
      // Both fall on the same IST calendar day (Aug 2), so nights = 1.
      const nights = nightsBetween('2026-08-01T20:00:00.000Z', '2026-08-02T02:00:00.000Z')
      expect(nights).toBe(1)
    })

    it('reverse trap: crosses IST midnight while UTC dates say same day', () => {
      // admit 2026-08-01T17:00:00.000Z = Aug 1 22:30 IST
      // discharge 2026-08-01T20:00:00.000Z = Aug 2 01:30 IST
      // The UTC date string is 2026-08-01 for both, but the IST calendar day
      // advances from Aug 1 to Aug 2, so nights = 1 (not 0).
      const nights = nightsBetween('2026-08-01T17:00:00.000Z', '2026-08-01T20:00:00.000Z')
      expect(nights).toBe(1)
    })

    it('throws when discharge is before admit', () => {
      expect(() =>
        nightsBetween('2026-08-02T03:30:00.000Z', '2026-08-01T03:30:00.000Z'),
      ).toThrow()
    })

    it('IST offset is load-bearing: IST says 1 night where UTC-day diff would say 2', () => {
      // admit 2026-08-01T23:30:00.000Z, discharge 2026-08-03T00:30:00.000Z
      // istDay(d) = floor((epochMs(d) + IST_OFFSET_MS) / 86_400_000)
      //   admit IST local:      2026-08-02T05:00:00.000Z → istDay = 20667
      //   discharge IST local:  2026-08-03T06:00:00.000Z → istDay = 20668
      //   nights(IST) = max(1, 20668 − 20667) = 1
      // A UTC-calendar-day diff (floor(epochMs/86_400_000) with no IST offset):
      //   admit utcDay = 20666 (2026-08-01), discharge utcDay = 20668 (2026-08-03)
      //   nights(UTC) = max(1, 20668 − 20666) = 2  ← would be wrong
      const nights = nightsBetween('2026-08-01T23:30:00.000Z', '2026-08-03T00:30:00.000Z')
      expect(nights).toBe(1)
    })

    it('IST offset is load-bearing (mirror): IST says 2 nights where UTC-day diff would say 1', () => {
      // admit 2026-08-01T17:00:00.000Z, discharge 2026-08-02T19:30:00.000Z
      // istDay(d) = floor((epochMs(d) + IST_OFFSET_MS) / 86_400_000)
      //   admit IST local:      2026-08-01T22:30:00.000Z → istDay = 20666
      //   discharge IST local:  2026-08-03T01:00:00.000Z → istDay = 20668
      //   nights(IST) = max(1, 20668 − 20666) = 2
      // A UTC-calendar-day diff (floor(epochMs/86_400_000) with no IST offset):
      //   admit utcDay = 20666 (2026-08-01), discharge utcDay = 20667 (2026-08-02)
      //   nights(UTC) = max(1, 20667 − 20666) = 1  ← would be wrong
      const nights = nightsBetween('2026-08-01T17:00:00.000Z', '2026-08-02T19:30:00.000Z')
      expect(nights).toBe(2)
    })
  })

  describe('computeInvoice', () => {
    it('computes a golden invoice with exact literals', () => {
      const lines: InvoiceLine[] = [
        { kind: 'PROCEDURE', description: 'Appendectomy', amountPaise: 1_250_000 },
        { kind: 'PHARMACY', description: 'Medications', amountPaise: 134_050 },
      ]
      const inv = computeInvoice({
        admittedAtIso: '2026-08-01T03:30:00.000Z',
        dischargedAtIso: '2026-08-04T03:30:00.000Z',
        roomRatePaise: 500_000,
        lines,
        depositPaise: 1_000_000,
      })

      expect(inv.nights).toBe(3)
      expect(inv.roomRatePaise).toBe(500_000)
      expect(inv.roomTotalPaise).toBe(1_500_000)
      expect(inv.extrasTotalPaise).toBe(1_384_050)
      expect(inv.depositPaise).toBe(1_000_000)
      expect(inv.balancePaise).toBe(1_884_050)
      expect(inv.isRefund).toBe(false)
      expect(inv.refundPaise).toBe(0)
    })

    it('C3: refund direction — deposit exceeds charges', () => {
      // 1 night at roomRatePaise 1_000_000, extras: procedure 300_000 + pharmacy 130_000
      // total charges = 1_430_000; deposit = 2_000_000 → balance = -570_000
      const lines: InvoiceLine[] = [
        { kind: 'PROCEDURE', description: 'Minor procedure', amountPaise: 300_000 },
        { kind: 'PHARMACY', description: 'Medications', amountPaise: 130_000 },
      ]
      const inv = computeInvoice({
        admittedAtIso: '2026-08-01T03:30:00.000Z',
        dischargedAtIso: '2026-08-01T11:30:00.000Z',
        roomRatePaise: 1_000_000,
        lines,
        depositPaise: 2_000_000,
      })

      expect(inv.roomTotalPaise).toBe(1_000_000)
      expect(inv.extrasTotalPaise).toBe(430_000)
      expect(inv.balancePaise).toBe(-570_000)
      expect(inv.isRefund).toBe(true)
      expect(inv.refundPaise).toBe(570_000)
      // Direction: the refund exactly equals what the deposit overshoots the charges by.
      expect(inv.refundPaise).toBe(inv.depositPaise - inv.roomTotalPaise - inv.extrasTotalPaise)
    })

    it('C4: balancePaise is always a safe integer equal to roomTotal + extras − deposit', () => {
      // Draw arbitrary minute offsets (not exact 24h multiples) so admit/discharge
      // land at arbitrary times of day, letting UTC- and IST-day boundaries fall
      // anywhere relative to the admit/discharge instants — including cases where
      // a naive UTC-day diff would disagree with the IST-day diff.
      const anchorMs = new Date('2026-08-01T00:00:00.000Z').getTime()
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 60 * 24 * 365 * 3 }), // admit offset, minutes since anchor (~3 years)
          fc.integer({ min: 0, max: 60 * 24 * 60 }), // duration, minutes (0 up to 60 days)
          fc.integer({ min: 0, max: 2_000_000 }), // roomRatePaise
          fc.array(fc.integer({ min: 0, max: 1_000_000 }), { maxLength: 20 }), // line amounts
          fc.integer({ min: 0, max: 10_000_000 }), // depositPaise
          (admitOffsetMinutes, durationMinutes, roomRatePaise, lineAmounts, depositPaise) => {
            const admittedAtIso = new Date(anchorMs + admitOffsetMinutes * 60_000).toISOString()
            const dischargedAtIso = new Date(
              anchorMs + admitOffsetMinutes * 60_000 + durationMinutes * 60_000,
            ).toISOString()
            const lines: InvoiceLine[] = lineAmounts.map((amountPaise, i) => ({
              kind: 'PHARMACY',
              description: `line-${i}`,
              amountPaise,
            }))

            const inv = computeInvoice({
              admittedAtIso,
              dischargedAtIso,
              roomRatePaise,
              lines,
              depositPaise,
            })

            expect(Number.isSafeInteger(inv.balancePaise)).toBe(true)
            const expectedBalance =
              inv.roomTotalPaise + inv.extrasTotalPaise - depositPaise
            expect(inv.balancePaise).toBe(expectedBalance)
          },
        ),
      )
    })

    it('rejects negative or non-integer roomRatePaise', () => {
      expect(() =>
        computeInvoice({
          admittedAtIso: '2026-08-01T03:30:00.000Z',
          dischargedAtIso: '2026-08-02T03:30:00.000Z',
          roomRatePaise: -1,
          lines: [],
          depositPaise: 0,
        }),
      ).toThrow()

      expect(() =>
        computeInvoice({
          admittedAtIso: '2026-08-01T03:30:00.000Z',
          dischargedAtIso: '2026-08-02T03:30:00.000Z',
          roomRatePaise: 1.5,
          lines: [],
          depositPaise: 0,
        }),
      ).toThrow()
    })

    it('rejects negative depositPaise', () => {
      expect(() =>
        computeInvoice({
          admittedAtIso: '2026-08-01T03:30:00.000Z',
          dischargedAtIso: '2026-08-02T03:30:00.000Z',
          roomRatePaise: 500_000,
          lines: [],
          depositPaise: -1,
        }),
      ).toThrow()
    })

    it('rejects negative line amounts', () => {
      expect(() =>
        computeInvoice({
          admittedAtIso: '2026-08-01T03:30:00.000Z',
          dischargedAtIso: '2026-08-02T03:30:00.000Z',
          roomRatePaise: 500_000,
          lines: [{ kind: 'TRANSPORT', description: 'Ambulance', amountPaise: -100 }],
          depositPaise: 0,
        }),
      ).toThrow()
    })
  })
})
