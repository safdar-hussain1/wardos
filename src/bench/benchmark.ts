import type { EventRow } from '../core/events'
import { seedHospital } from '../seed/seed'
import type { CommandRecord } from '../naive/types'
import { runFloatMoney } from '../naive/floatMoney'
import type { FloatMoneyReport } from '../naive/floatMoney'
import { runOccupancyFlag } from '../naive/occupancyFlag'
import type { OccupancyFlagReport } from '../naive/occupancyFlag'
import { runMsDates } from '../naive/msDates'
import type { MsDatesReport } from '../naive/msDates'
import { probeInvoicesWrong, probeDoubleBookings, probeBedsDrifted, probeCounts } from './probes'

export type { CommandRecord }

export interface WardosRow {
  invoicesWrong: number
  bedsDrifted: number
  doubleBookingsAccepted: number
  // Evidence the probes above actually examined real rows, not that they
  // trivially found nothing to check — see probeCounts in ./probes.ts.
  invoicesChecked: number
  bedsChecked: number
  admissionsTotal: number
}

export interface BenchmarkReport {
  commands: number
  n1: FloatMoneyReport
  n2: OccupancyFlagReport
  n3: MsDatesReport
  wardos: WardosRow
}

/**
 * `events` from `Engine.eventsLog()` come back newest-first; re-sort
 * ascending by id to get the chronological command stream the seed
 * actually produced, then parse each payload.
 */
export function deriveCommandRecords(events: readonly EventRow[]): CommandRecord[] {
  return [...events]
    .sort((a, b) => a.id - b.id)
    .map((e) => ({ action: e.action, at: e.at, payload: JSON.parse(e.payload) as unknown }))
}

/**
 * Seeds a fresh six-month hospital, replays its real event log into each
 * naive baseline, and cross-checks the `wardos` row against the live db via
 * real SQL probes (see `./probes.ts`) — never assumed to be zero.
 */
export async function runBenchmark(): Promise<BenchmarkReport> {
  const { db, engine, commandCount } = await seedHospital()

  const records = deriveCommandRecords(engine.eventsLog())

  const n1 = runFloatMoney(records)
  const n2 = runOccupancyFlag(records)
  const n3 = runMsDates(records)

  const invoicesWrong = probeInvoicesWrong(db)
  const bedsDrifted = probeBedsDrifted(db)
  const doubleBookingsAccepted = probeDoubleBookings(db)
  if (invoicesWrong !== 0 || bedsDrifted !== 0 || doubleBookingsAccepted !== 0) {
    throw new Error(
      `wardos ground-truth probes found real problems (invoicesWrong=${invoicesWrong}, ` +
        `bedsDrifted=${bedsDrifted}, doubleBookingsAccepted=${doubleBookingsAccepted}) — ` +
        `the wardos row is no longer all-zero; fix the underlying bug before publishing this report`,
    )
  }

  const counts = probeCounts(db)

  return {
    commands: commandCount,
    n1,
    n2,
    n3,
    // The computed probe variables themselves, not a hardcoded literal —
    // the throw above is what guarantees they're 0, not this assignment.
    wardos: {
      invoicesWrong,
      bedsDrifted,
      doubleBookingsAccepted,
      invoicesChecked: counts.invoicesChecked,
      bedsChecked: counts.bedsChecked,
      admissionsTotal: counts.admissionsTotal,
    },
  }
}
