import type { CommandRecord } from './types'

/**
 * N1 — "floatMoney": the naive, wrong way to bill a hospital stay. Instead
 * of keeping every amount in integer paise (as `src/core/billing.ts` does),
 * this baseline converts every amount to a rupee `double` the moment it
 * sees it (`paise / 100`), accumulates totals with plain `+`, and only
 * rounds back to paise at the very end. It also applies a "promotional
 * service adjustment": 2.5% added, then 2.5% removed — `total +=
 * total*0.025; total -= total*0.025`.
 *
 * That reversal is NOT a no-op, and the residue it leaves is NOT float
 * representation error — it's real in exact arithmetic too. The second
 * step computes 2.5% of the *already-inflated* total (`total * 1.025`),
 * not 2.5% of the original: `(t * 1.025) - (t * 1.025 * 0.025) = t *
 * 1.025 * 0.975 = t * 0.999375`. Every bill this touches comes out
 * exactly 0.0625% short — an order-of-operations bug that float-rupee
 * bookkeeping invites (a spreadsheet-style "add a surcharge, back it out"
 * pattern applied to a running total instead of a fixed base) and that
 * integer-paise, single-computation billing avoids by construction, since
 * there's no running total for a second adjustment to compound against.
 * True sub-paise float-representation drift (`0.1 + 0.2 !== 0.3`-class
 * error) also exists in this code path, but at these amounts and this
 * operation count it's negligible next to the −0.0625% residue — the
 * residue is what actually drives `n1`'s numbers.
 *
 * Deliberately does NOT import anything from `src/core/billing.ts` — this
 * is the wrong implementation, kept in isolation on purpose. `nights` and
 * `roomRatePaise` are read off the real invoice embedded in the DISCHARGED
 * payload (the command stream never carries a bed's rate on its own, and
 * getting the *date math* right is N3's concern, not N1's) — only the
 * *money arithmetic* is naive here.
 */
export interface FloatMoneyReport {
  description: string
  invoicesWrong: number
  worstErrorPaise: number
  totalAbsErrorPaise: number
}

/**
 * Exported so the exact wording is testable and can't silently drift from
 * what the code actually does (see tests/benchmark.test.ts).
 */
export const FLOAT_MONEY_DESCRIPTION =
  'Bills in rupee doubles instead of integer paise, then applies a 2.5% ' +
  "service adjustment that's added and 'removed' — but the removal " +
  'computes 2.5% of the already-inflated total, not the original, leaving ' +
  'a real ×0.999375 (−0.0625% residue) on every bill in exact arithmetic, ' +
  'before float representation error is even a factor. Integer-paise, ' +
  "single-computation billing avoids this by construction: there's no " +
  'running total left standing for a second adjustment to compound against.'

interface AdmissionMoneyState {
  depositRupees: number
  chargeRupees: number[]
}

interface AdmittedPayload {
  admissionId: number
  depositPaise: number
}

interface DepositRecordedPayload {
  admissionId: number
  amountPaise: number
}

interface ChargeAddedPayload {
  admissionId: number
  amountPaise: number
}

interface DischargedPayload {
  admissionId: number
  invoice: {
    nights: number
    roomRatePaise: number
    balancePaise: number
  }
}

export function runFloatMoney(records: readonly CommandRecord[]): FloatMoneyReport {
  const state = new Map<number, AdmissionMoneyState>()

  let invoicesWrong = 0
  let worstErrorPaise = 0
  let totalAbsErrorPaise = 0

  for (const record of records) {
    switch (record.action) {
      case 'ADMITTED': {
        const p = record.payload as AdmittedPayload
        state.set(p.admissionId, { depositRupees: p.depositPaise / 100, chargeRupees: [] })
        break
      }
      case 'DEPOSIT_RECORDED': {
        const p = record.payload as DepositRecordedPayload
        const s = state.get(p.admissionId)
        if (s) s.depositRupees += p.amountPaise / 100
        break
      }
      case 'CHARGE_ADDED': {
        const p = record.payload as ChargeAddedPayload
        const s = state.get(p.admissionId)
        if (s) s.chargeRupees.push(p.amountPaise / 100)
        break
      }
      case 'DISCHARGED': {
        const p = record.payload as DischargedPayload
        const s = state.get(p.admissionId)
        if (!s) break

        // Money kept as rupee doubles throughout — this is the bug.
        let total = p.invoice.nights * (p.invoice.roomRatePaise / 100)
        for (const chargeRupees of s.chargeRupees) {
          total += chargeRupees
        }
        total -= s.depositRupees

        // A realistic promotional adjust cycle: 2.5% added, then 2.5%
        // "removed" — but the removal computes 2.5% of the now-inflated
        // total, not the original, so this leaves a real ×0.999375
        // (−0.0625%) residue on every bill, in exact arithmetic, before
        // float representation error is even a factor. See the doc
        // comment above.
        total += total * 0.025
        total -= total * 0.025

        const naivePaise = Math.round(total * 100)
        const diff = naivePaise - p.invoice.balancePaise
        if (diff !== 0) {
          invoicesWrong++
          const absDiff = Math.abs(diff)
          totalAbsErrorPaise += absDiff
          if (absDiff > worstErrorPaise) worstErrorPaise = absDiff
        }

        state.delete(p.admissionId)
        break
      }
      default:
        break
    }
  }

  return { description: FLOAT_MONEY_DESCRIPTION, invoicesWrong, worstErrorPaise, totalAbsErrorPaise }
}
