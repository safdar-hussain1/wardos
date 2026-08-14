import type { CommandRecord } from './types'

/**
 * N3 — "msDates": the naive, wrong way to count a stay's nights. Instead of
 * counting IST *calendar days* crossed with a one-night minimum (as
 * `nightsBetween` in `src/core/billing.ts` does), this baseline just
 * divides the raw elapsed milliseconds by a day and rounds — no timezone,
 * no minimum. A patient admitted and discharged on the same calendar day
 * (a real day case) should still be billed one night; naive rounding of a
 * same-day stay under 12 hours produces zero.
 *
 * Recomputes each discharged invoice's balance using the naive night count
 * but the TRUE rate/extras/deposit (all already integer paise, read off
 * the real invoice embedded in the DISCHARGED payload) — so any mismatch
 * is attributable only to the naive night count, not to money precision
 * (that's N1's bug) or anything else.
 *
 * Deliberately does NOT import anything from `src/core/billing.ts` — this
 * is the wrong implementation, kept in isolation on purpose.
 */
export interface MsDatesReport {
  description: string
  invoicesWrong: number
  nightsUnderbilled: number
  nightsOverbilled: number
  dayCasesFreed: number
}

/**
 * Exported so the exact wording is testable and can't silently drift from
 * what the code actually does (see tests/benchmark.test.ts).
 */
export const MS_DATES_DESCRIPTION =
  'Counts nights as round((dischargeMs − admitMs) / 86,400,000) — raw ' +
  'elapsed time, no timezone, no one-night minimum — instead of counting ' +
  'IST calendar days crossed. A same-day day case under 12 hours rounds ' +
  'to 0 nights instead of the correct 1, and every other stay is off by ' +
  'however many hours it lands away from an exact 24-hour boundary.'

interface AdmittedPayload {
  admissionId: number
}

interface DischargedPayload {
  admissionId: number
  invoice: {
    nights: number
    roomRatePaise: number
    extrasTotalPaise: number
    depositPaise: number
    balancePaise: number
  }
}

const MS_PER_DAY = 86_400_000

export function runMsDates(records: readonly CommandRecord[]): MsDatesReport {
  const admittedAtMs = new Map<number, number>()

  let invoicesWrong = 0
  let nightsUnderbilled = 0
  let nightsOverbilled = 0
  let dayCasesFreed = 0

  for (const record of records) {
    if (record.action === 'ADMITTED') {
      const p = record.payload as AdmittedPayload
      admittedAtMs.set(p.admissionId, new Date(record.at).getTime())
      continue
    }

    if (record.action !== 'DISCHARGED') continue

    const p = record.payload as DischargedPayload
    const admitMs = admittedAtMs.get(p.admissionId)
    if (admitMs === undefined) continue

    const dischargeMs = new Date(record.at).getTime()
    const naiveNights = Math.round((dischargeMs - admitMs) / MS_PER_DAY)

    const naiveRoomTotalPaise = p.invoice.roomRatePaise * naiveNights
    const naiveBalancePaise = naiveRoomTotalPaise + p.invoice.extrasTotalPaise - p.invoice.depositPaise

    if (naiveBalancePaise !== p.invoice.balancePaise) invoicesWrong++

    if (naiveNights < p.invoice.nights) {
      nightsUnderbilled += p.invoice.nights - naiveNights
    } else if (naiveNights > p.invoice.nights) {
      nightsOverbilled += naiveNights - p.invoice.nights
    }

    if (naiveNights === 0) dayCasesFreed++

    admittedAtMs.delete(p.admissionId)
  }

  return { description: MS_DATES_DESCRIPTION, invoicesWrong, nightsUnderbilled, nightsOverbilled, dayCasesFreed }
}
