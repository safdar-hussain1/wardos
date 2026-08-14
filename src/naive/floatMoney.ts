import type { CommandRecord } from './types'

/**
 * N1 — "floatMoney": the naive, wrong way to bill a hospital stay. Instead
 * of keeping every amount in integer paise (as `src/core/billing.ts` does),
 * this baseline converts every amount to a rupee `double` the moment it
 * sees it (`paise / 100`), accumulates totals with plain `+`, and only
 * rounds back to paise at the very end. It also applies a "promotional
 * service adjustment" that's added then immediately removed — a realistic
 * pattern (a discount toggled on then off during a billing review) that
 * should be a no-op but, in float arithmetic, isn't always.
 *
 * Deliberately does NOT import anything from `src/core/billing.ts` — this
 * is the wrong implementation, kept in isolation on purpose. `nights` and
 * `roomRatePaise` are read off the real invoice embedded in the DISCHARGED
 * payload (the command stream never carries a bed's rate on its own, and
 * getting the *date math* right is N3's concern, not N1's) — only the
 * *money arithmetic* is naive here.
 */
export interface FloatMoneyReport {
  invoicesWrong: number
  worstErrorPaise: number
  totalAbsErrorPaise: number
}

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

        // A realistic promotional adjust cycle: applied then reversed. In
        // exact arithmetic this is a no-op; in float arithmetic it isn't
        // always.
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

  return { invoicesWrong, worstErrorPaise, totalAbsErrorPaise }
}
