import type { Paise } from './money'
import { paise, mulP, addP, subP, sumP } from './money'

// IST (Asia/Kolkata) is UTC+5:30 year-round — India does not observe DST,
// so a fixed offset is correct for all dates, not just an approximation.
export const IST_OFFSET_MS = 5.5 * 3600_000

function istDay(epochMs: number): number {
  return Math.floor((epochMs + IST_OFFSET_MS) / 86_400_000)
}

/**
 * Calendar nights billed, computed on IST calendar days (not elapsed 24h periods).
 * A patient admitted and discharged on the same IST calendar day is still billed
 * for 1 night (minimum). Throws if discharge is before admit.
 */
export function nightsBetween(admittedAtIso: string, dischargedAtIso: string): number {
  const admittedMs = new Date(admittedAtIso).getTime()
  const dischargedMs = new Date(dischargedAtIso).getTime()

  if (Number.isNaN(admittedMs)) {
    throw new Error(`nightsBetween: invalid admittedAtIso "${admittedAtIso}"`)
  }
  if (Number.isNaN(dischargedMs)) {
    throw new Error(`nightsBetween: invalid dischargedAtIso "${dischargedAtIso}"`)
  }
  if (dischargedMs < admittedMs) {
    throw new Error(
      `nightsBetween: dischargedAtIso (${dischargedAtIso}) is before admittedAtIso (${admittedAtIso})`,
    )
  }

  const nights = istDay(dischargedMs) - istDay(admittedMs)
  return Math.max(1, nights)
}

// Matches the `kind` CHECK constraint on the `charges` table (src/db/schema.sql).
export type ChargeKind = 'PROCEDURE' | 'PHARMACY' | 'CONSULTATION' | 'TRANSPORT'

export interface InvoiceLine {
  kind: ChargeKind
  description: string
  amountPaise: Paise
}

export interface ComputedInvoice {
  nights: number
  roomRatePaise: Paise
  roomTotalPaise: Paise
  lines: InvoiceLine[]
  extrasTotalPaise: Paise
  depositPaise: Paise
  balancePaise: Paise // roomTotal + extras − deposit; negative ⇒ refund
  isRefund: boolean // balancePaise < 0
  refundPaise: Paise // isRefund ? −balancePaise : 0
}

function assertNonNegativePaise(value: number, label: string): Paise {
  const p = paise(value) // throws on non-integer / unsafe integer
  if (p < 0) {
    throw new Error(`computeInvoice: ${label} must be non-negative, got ${p}`)
  }
  return p
}

export function computeInvoice(args: {
  admittedAtIso: string
  dischargedAtIso: string
  roomRatePaise: Paise
  lines: InvoiceLine[]
  depositPaise: Paise
}): ComputedInvoice {
  const { admittedAtIso, dischargedAtIso, lines, depositPaise } = args

  const roomRatePaise = assertNonNegativePaise(args.roomRatePaise, 'roomRatePaise')
  const validatedDeposit = assertNonNegativePaise(depositPaise, 'depositPaise')

  const validatedLines: InvoiceLine[] = lines.map((line, i) => {
    assertNonNegativePaise(line.amountPaise, `lines[${i}].amountPaise`)
    return line
  })

  const nights = nightsBetween(admittedAtIso, dischargedAtIso)
  const roomTotalPaise = mulP(roomRatePaise, nights)
  const extrasTotalPaise = sumP(validatedLines.map((l) => l.amountPaise))

  const balancePaise = subP(addP(roomTotalPaise, extrasTotalPaise), validatedDeposit)
  const isRefund = balancePaise < 0
  const refundPaise = isRefund ? -balancePaise : 0

  return {
    nights,
    roomRatePaise,
    roomTotalPaise,
    lines: validatedLines,
    extrasTotalPaise,
    depositPaise: validatedDeposit,
    balancePaise,
    isRefund,
    refundPaise,
  }
}
