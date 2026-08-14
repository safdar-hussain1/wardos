import type { CommandRecord } from './types'

/**
 * N2 — "occupancyFlag": the naive, wrong way to track which beds are free.
 * Instead of deriving occupancy from the admissions table itself (as
 * `Engine.beds()` does — a bed is occupied iff it has an ACTIVE admission,
 * always consistent by construction), this baseline maintains a *second*,
 * independent `occupied` boolean per bed that has to be kept in sync by
 * hand: an "admission write" (closing/opening the admission in an in-memory
 * store) followed by a *separate* "flag write". That second write is
 * exactly the kind of step a real system drops under load — simulated here
 * as a deterministic crash on every 7th discharge (by stream order): the
 * admission closes correctly, but the flag never gets cleared, so the bed
 * reads "occupied" forever after.
 *
 * `truth` is tracked alongside `flag` purely as an audit oracle (derived
 * the same reliable way `Engine.beds()` would derive it) — it is not
 * itself subject to the crash, so comparing the two is what makes
 * `bedsDrifted` and `doubleBookingsAccepted` meaningful.
 *
 * Deliberately does NOT import anything from `src/core/billing.ts` (N2
 * doesn't touch money at all) or any other core module — this is the wrong
 * implementation, kept in isolation on purpose.
 */
export interface OccupancyFlagReport {
  bedsDrifted: number
  doubleBookingsAccepted: number
  crashesInjected: number
}

interface AdmittedPayload {
  admissionId: number
  bedId: number
}

interface TransferredPayload {
  admissionId: number
  toBedId: number
}

interface DischargedPayload {
  admissionId: number
}

export function runOccupancyFlag(records: readonly CommandRecord[]): OccupancyFlagReport {
  // The buggy, hand-maintained "second write" store.
  const flag = new Map<number, boolean>()
  // The reliable audit oracle — never touched by the crash.
  const truth = new Map<number, boolean>()
  // admissionId -> the bed it currently occupies (needed because
  // TRANSFERRED only carries `toBedId`, not `fromBedId`).
  const currentBed = new Map<number, number>()

  let dischargeOrdinal = 0
  let crashesInjected = 0
  let doubleBookingsAccepted = 0

  for (const record of records) {
    switch (record.action) {
      case 'ADMITTED': {
        const p = record.payload as AdmittedPayload

        // A double booking: the flag said this bed was free, but the
        // reliable truth store says it's actually occupied.
        if (flag.get(p.bedId) === false && truth.get(p.bedId) === true) {
          doubleBookingsAccepted++
        }

        currentBed.set(p.admissionId, p.bedId)
        truth.set(p.bedId, true) // write 1: the admission insert
        flag.set(p.bedId, true) // write 2: the separate flag write (never crashes on admit)
        break
      }
      case 'TRANSFERRED': {
        const p = record.payload as TransferredPayload
        const fromBedId = currentBed.get(p.admissionId)
        currentBed.set(p.admissionId, p.toBedId)

        if (fromBedId !== undefined) {
          truth.set(fromBedId, false)
          flag.set(fromBedId, false)
        }
        truth.set(p.toBedId, true)
        flag.set(p.toBedId, true)
        break
      }
      case 'DISCHARGED': {
        const p = record.payload as DischargedPayload
        const bedId = currentBed.get(p.admissionId)
        if (bedId === undefined) break

        dischargeOrdinal++
        truth.set(bedId, false) // write 1: closing the admission — always succeeds

        const crashes = dischargeOrdinal % 7 === 0
        if (crashes) {
          crashesInjected++
          // write 2 (clearing the flag) is dropped — the flag stays occupied.
        } else {
          flag.set(bedId, false)
        }
        break
      }
      default:
        break
    }
  }

  let bedsDrifted = 0
  const allBedIds = new Set<number>([...flag.keys(), ...truth.keys()])
  for (const bedId of allBedIds) {
    const flagOccupied = flag.get(bedId) ?? false
    const trueOccupied = truth.get(bedId) ?? false
    if (flagOccupied !== trueOccupied) bedsDrifted++
  }

  return { bedsDrifted, doubleBookingsAccepted, crashesInjected }
}
