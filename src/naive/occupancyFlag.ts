import type { CommandRecord } from './types'

/**
 * N2 — "occupancyFlag": the naive, wrong way to track which beds are free.
 * Instead of deriving occupancy from the admissions table itself (as
 * `Engine.beds()` does — a bed is occupied iff it has an ACTIVE admission,
 * always consistent by construction), this baseline maintains a *second*,
 * independent `occupied` boolean per bed that has to be kept in sync by
 * hand: an "admission write" (opening/closing the admission in an in-memory
 * store) followed by a *separate* "flag write". That second write is
 * exactly the kind of step a real system drops under load — simulated here
 * as two deterministic crashes, in opposite directions:
 *
 *   - every 7th DISCHARGE (by stream order) drops the flag-clearing write:
 *     the admission closes correctly, but the flag stays "occupied" —
 *     fails *safe* (over-cautious, wastes a real free bed), and can never
 *     by itself cause a double booking (see the comment at the ADMIT case
 *     below for why).
 *   - every 11th ADMIT (by stream order) drops the flag-*setting* write:
 *     the admission opens correctly, but the flag stays "free" — fails
 *     *unsafe* (permissive), and is the only one of the two that can ever
 *     let a real double booking through.
 *
 * N2 also has no code path at all for TRANSFERRED — its write pattern is
 * only ever described in terms of an admission insert and closing an
 * admission, and a transfer is neither, so a transferred patient's old bed
 * is simply never revisited by N2. That gap is what lets an admit crash's
 * stale "free" reading survive long enough to be reused by a genuinely
 * different, later admission (see the ADMIT case below).
 *
 * `truth` is tracked alongside `flag` as a second, independently-updated
 * ledger — not itself subject to the flag-drop, so comparing the two is
 * what makes `bedsDrifted` and `doubleBookingsAccepted` meaningful. It is
 * NOT a live re-derivation from `Engine.beds()` (that would make it
 * reliable by construction, unlike anything a real naive system would
 * have) — it is built from the exact same ADMIT/DISCHARGE write pattern as
 * `flag`, just without that pattern's dropped second write.
 *
 * Deliberately does NOT import anything from `src/core/billing.ts` (N2
 * doesn't touch money at all) or any other core module — this is the wrong
 * implementation, kept in isolation on purpose.
 */
export interface OccupancyFlagReport {
  description: string
  bedsDrifted: number
  doubleBookingsAccepted: number
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
  '(flag stays stuck free) — plus has no code path for transfers at all, ' +
  "so a transferred patient's old bed is never revisited. The discharge " +
  'crash alone can never cause a double booking — it only ever makes the ' +
  'flag too cautious (occupied when actually free), never too permissive. ' +
  "Only the admit crash's stuck-free flag, combined with the transfer " +
  'blindness letting that stale reading survive long enough to be reused ' +
  'by a different, later admission, can.'

interface AdmittedPayload {
  admissionId: number
  bedId: number
}

interface DischargedPayload {
  admissionId: number
}

export function runOccupancyFlag(records: readonly CommandRecord[]): OccupancyFlagReport {
  // The buggy, hand-maintained "second write" store.
  const flag = new Map<number, boolean>()
  // A second, independently-maintained ledger — same write pattern as
  // `flag`, minus the dropped write, so the two can be compared.
  const truth = new Map<number, boolean>()
  // admissionId -> the bed it was ADMITTED into. Deliberately never
  // updated by TRANSFERRED (see the doc comment above) — so once a patient
  // transfers, this (and therefore their eventual DISCHARGE) still points
  // at their *original* bed, not their current one.
  const currentBed = new Map<number, number>()

  let admitOrdinal = 0
  let dischargeOrdinal = 0
  let crashesOnAdmit = 0
  let crashesOnDischarge = 0
  let doubleBookingsAccepted = 0

  for (const record of records) {
    switch (record.action) {
      case 'ADMITTED': {
        const p = record.payload as AdmittedPayload

        // A double booking: the flag said this bed was free, but the
        // second ledger says it's actually occupied. This can ONLY ever
        // fire because of the combination of two bugs: an earlier admit
        // crash left this bed's flag stuck "free" while `truth` correctly
        // recorded it occupied, AND the occupant was later transferred
        // out (a move N2 never sees — see the TRANSFERRED case) before
        // their own discharge could resync it. Note what's absent from
        // that list: the discharge crash. It can't contribute here, by
        // construction — it only ever *sets* a flag to occupied it
        // shouldn't (fails safe), never clears one it shouldn't (which is
        // the only direction that could make THIS check fire). And
        // without the transfer gap, `truth` would already have gone back
        // to false the moment the crashed admission's own (always
        // correctly-tracked) discharge happened — real wardos never
        // double-books a bed (its schema enforces that), so no later
        // ADMIT could ever find `truth` still true for a bed it's legally
        // being admitted into.
        if ((flag.get(p.bedId) ?? false) === false && truth.get(p.bedId) === true) {
          doubleBookingsAccepted++
        }

        currentBed.set(p.admissionId, p.bedId)
        truth.set(p.bedId, true) // write 1: the admission insert — always succeeds

        admitOrdinal++
        const crashes = admitOrdinal % 11 === 0
        if (crashes) {
          crashesOnAdmit++
          // write 2 (setting the flag) is dropped — the flag stays free,
          // even though the bed is now truly occupied. Unlike the
          // discharge crash (below), this fails *unsafe*: it under-reports
          // occupancy, so it's the only one of the two crash types that can
          // ever let a real double booking slip through the flag.
        } else {
          flag.set(p.bedId, true) // write 2: the separate flag write
        }
        break
      }
      case 'TRANSFERRED': {
        // N2's write pattern is only ever described in terms of an
        // "admission insert" (ADMIT) and "closing the admission"
        // (DISCHARGE) — a transfer is neither, so N2 has no code path for
        // it at all: a transferred patient's *old* bed is never marked
        // free by N2 (its truth/flag entries are simply left exactly as
        // they were), and the *new* bed is never marked occupied by N2
        // either. This is a second, independent naive bug, not the
        // flag-write-drop — but it's the reason a stale "free" flag from an
        // admit crash can survive long enough to be exploited: without it,
        // the crashed admission's own eventual (correctly-tracked)
        // discharge would always resync its bed before anyone else could
        // reuse it, and doubleBookingsAccepted would be structurally
        // impossible no matter how the crash was shaped (see the note
        // above on why the discharge crash alone can never cause one).
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
          crashesOnDischarge++
          // write 2 (clearing the flag) is dropped — the flag stays
          // occupied even though the bed is now truly free. This fails
          // *safe*: it over-reports occupancy (denies/wastes a real free
          // bed), which is exactly why this crash alone can never cause a
          // double booking — a stuck-occupied flag can only ever make the
          // naive system too cautious, never too permissive.
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

  return {
    description: OCCUPANCY_FLAG_DESCRIPTION,
    bedsDrifted,
    doubleBookingsAccepted,
    crashesInjected: crashesOnAdmit + crashesOnDischarge,
    crashesOnAdmit,
    crashesOnDischarge,
  }
}
