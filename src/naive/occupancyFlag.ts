import type { CommandRecord } from './types'

/**
 * N2 — "occupancyFlag": the naive, wrong way to track which beds are free.
 * Instead of deriving occupancy from the admissions table itself (as
 * `Engine.beds()` does — a bed is occupied iff it has an ACTIVE admission,
 * always consistent by construction), this baseline maintains a *second*,
 * independent `occupied` boolean per bed that has to be kept in sync by
 * hand: an "admission write" (opening/closing/moving the admission in an
 * in-memory store) followed by a *separate* "flag write". That second
 * write is exactly the kind of step a real system drops under load —
 * simulated here as two deterministic crashes, in opposite directions:
 *
 *   - every 7th DISCHARGE (by stream order) drops the flag-clearing write:
 *     the admission closes correctly, but the flag stays "occupied" —
 *     fails *safe* (over-cautious: turns away a real patient from a
 *     genuinely free bed).
 *   - every 11th ADMIT (by stream order) drops the flag-*setting* write:
 *     the admission opens correctly, but the flag stays "free" — fails
 *     *unsafe* (permissive: tells a receptionist a truly occupied bed is
 *     free).
 *
 * `truth` is a fully faithful occupancy oracle — every ADMIT, TRANSFER, and
 * DISCHARGE updates it correctly, and it is NEVER subject to either crash.
 * It exists purely so `flag` can be checked against it; comparing the two
 * is what makes every metric below meaningful.
 *
 * A note on what this baseline does NOT and CANNOT measure: an *accepted*
 * double booking (two genuinely overlapping admissions on one bed) cannot
 * be produced by replaying wardos's own event log, no matter how `flag` is
 * corrupted — the schema that produced that log (`uq_active_bed`) never
 * allowed a colliding admit to exist in the first place, so the flag's
 * accept/reject verdict is never actually put to a real conflict. What the
 * crash-prone flag system produces instead, and what IS measurable from
 * real replay, is two different failure modes: `wrongfulRefusals` (the
 * flag turns away a real admission from a bed that's genuinely free) and
 * `phantomFreeBeds` (the flag tells a receptionist a genuinely occupied
 * bed is free — a standing double-booking *hazard*, even on the six
 * months of history here where nothing happened to walk through that open
 * door).
 *
 * Deliberately does NOT import anything from `src/core/billing.ts` (N2
 * doesn't touch money at all) or any other core module — this is the wrong
 * implementation, kept in isolation on purpose.
 */
export interface OccupancyFlagReport {
  description: string
  bedsDrifted: number
  wrongfulRefusals: number
  phantomFreeBeds: number
  phantomFreeAtEnd: number
  crashesInjected: number
  crashesOnAdmit: number
  crashesOnDischarge: number
}

/**
 * Exported so the exact wording is testable and can't silently drift from
 * what the code actually does (see tests/benchmark.test.ts).
 */
export const OCCUPANCY_FLAG_DESCRIPTION =
  'Tracks bed occupancy with a second, hand-maintained flag written ' +
  'separately from the admission record, and drops that second write on ' +
  'every 7th discharge (flag stays stuck occupied) and every 11th admit ' +
  '(flag stays stuck free), checked against a fully faithful truth oracle ' +
  'that tracks every admit, transfer, and discharge correctly and is ' +
  'never itself subject to a crash. An accepted double booking cannot be ' +
  'measured by replaying a valid log — the schema that produced the log ' +
  'never allowed a colliding admit to exist, so the flag\'s acceptance ' +
  'verdict is never actually put to a real conflict. What the crash-prone ' +
  'flag system produces instead is phantom-free beds (double-booking ' +
  'hazards: the admit crash leaves a truly occupied bed reading free to ' +
  'anyone who trusts the flag) and wrongful refusals of genuinely free ' +
  'beds (the discharge crash leaves a truly free bed reading occupied). ' +
  'bedsDrifted counts how many of those mismatches, in either direction, ' +
  'are still unresolved at the end of the six months.'

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
  // A fully faithful occupancy oracle — every write here always succeeds,
  // for every action, including transfers. Never subject to either crash.
  const truth = new Map<number, boolean>()
  // admissionId -> the bed it currently occupies, per `truth` — correctly
  // updated on both ADMIT and TRANSFER, so DISCHARGE always targets the
  // right bed.
  const currentBed = new Map<number, number>()

  let admitOrdinal = 0
  let dischargeOrdinal = 0
  let crashesOnAdmit = 0
  let crashesOnDischarge = 0
  let wrongfulRefusals = 0
  let phantomFreeBeds = 0

  for (const record of records) {
    switch (record.action) {
      case 'ADMITTED': {
        const p = record.payload as AdmittedPayload

        // A wrongful refusal: the flag says this bed is occupied, but the
        // faithful oracle says it's genuinely free — a real admission is
        // happening here anyway (wardos itself doesn't consult this naive
        // flag), but a receptionist trusting the flag would have turned
        // this exact, legitimate patient away.
        const flagOccupiedBefore = flag.get(p.bedId) ?? false
        const trulyOccupiedBefore = truth.get(p.bedId) ?? false
        if (flagOccupiedBefore === true && trulyOccupiedBefore === false) {
          wrongfulRefusals++
        }

        currentBed.set(p.admissionId, p.bedId)
        truth.set(p.bedId, true) // faithful write — always succeeds

        admitOrdinal++
        const crashes = admitOrdinal % 11 === 0
        if (crashes) {
          crashesOnAdmit++
          // The flag-setting write is dropped — the flag stays free even
          // though the bed is now genuinely occupied. This is exactly the
          // moment a new phantom-free-bed hazard is created.
          phantomFreeBeds++
        } else {
          flag.set(p.bedId, true) // write 2: the separate flag write
        }
        break
      }
      case 'TRANSFERRED': {
        // Transfers are not a crash point — both writes always succeed,
        // for both the faithful oracle and the flag, so `truth` and `flag`
        // move together here and a transfer never itself introduces drift.
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
        truth.set(bedId, false) // faithful write — always succeeds

        const crashes = dischargeOrdinal % 7 === 0
        if (crashes) {
          crashesOnDischarge++
          // write 2 (clearing the flag) is dropped — the flag stays
          // occupied even though the bed is now genuinely free. This is
          // what a later ADMIT to this same bed will detect as a
          // wrongful refusal (see the ADMITTED case above).
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
  let phantomFreeAtEnd = 0
  const allBedIds = new Set<number>([...flag.keys(), ...truth.keys()])
  for (const bedId of allBedIds) {
    const flagOccupied = flag.get(bedId) ?? false
    const trueOccupied = truth.get(bedId) ?? false
    if (flagOccupied !== trueOccupied) {
      bedsDrifted++
      if (!flagOccupied && trueOccupied) phantomFreeAtEnd++
    }
  }

  return {
    description: OCCUPANCY_FLAG_DESCRIPTION,
    bedsDrifted,
    wrongfulRefusals,
    phantomFreeBeds,
    phantomFreeAtEnd,
    crashesInjected: crashesOnAdmit + crashesOnDischarge,
    crashesOnAdmit,
    crashesOnDischarge,
  }
}
