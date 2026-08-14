import bcryptDefault from 'bcryptjs'
import { Db } from '../db/database'
import { FixedClock, ANCHOR_ISO } from '../core/clock'
import { Engine } from '../core/engine'
import type { Actor, StaffInput } from '../core/engine'
import { mulberry32, pick, randInt } from '../core/rng'
import type { ChargeKind } from '../core/billing'
import type { Role } from '../core/permissions'
import type { Paise } from '../core/money'
import { WARD_CONFIG, DEMO_ACCOUNTS, DEMO_SALTS, insertFacility } from './facility'
import {
  FEMALE_GIVEN_NAMES,
  MALE_GIVEN_NAMES,
  FAMILY_NAMES,
  DEPARTMENTS,
  DOCTOR_SPECIALTIES,
  DIAGNOSES,
  PROCEDURE_DESCRIPTIONS,
  PHARMACY_DESCRIPTIONS,
  CONSULTATION_DESCRIPTIONS,
  TRANSPORT_DESCRIPTIONS,
  DISPATCH_LOCATIONS,
} from './names'

/**
 * `seedHospital()` builds a deterministic, six-month history of a running
 * hospital: five demo logins, fifteen staff, dozens of patients cycling
 * through admissions/charges/discharges, ambulance runs, and a handful of
 * refunds — entirely through `Engine` commands, so the resulting `events`
 * table is a real, replayable audit log (C2 holds over it — see
 * tests/seed.test.ts).
 *
 * Determinism: a single `mulberry32` PRNG (seeded `20260801`) drives every
 * random choice below, and the clock is a `FixedClock` that only ever moves
 * forward under this function's control — no `Date.now()`, no
 * `Math.random()`, anywhere in this module or its helpers. Two calls to
 * `seedHospital()` therefore produce byte-identical `db.serialize()` output,
 * *except* for bcrypt's password hashes, which are pinned separately — see
 * `withFixedDemoSalts` below and the doc comment on `DEMO_SALTS` in
 * facility.ts.
 */
export interface SeedResult {
  db: Db
  engine: Engine
  clock: FixedClock
  commandCount: number
}

/**
 * userId 0 is the system bootstrap actor. It is the actor on the five
 * USER_CREATED events that create DEMO_ACCOUNTS, because — by construction —
 * no real user exists yet to attribute that first action to.
 * `events.actor_user_id` carries no foreign key (see schema.sql), so 0 is a
 * safe sentinel; it never collides with a real `users.id` (SQLite INTEGER
 * PRIMARY KEY starts at 1).
 */
const BOOTSTRAP: Actor = { userId: 0, role: 'ADMIN', username: 'system' }

const SEED_START_ISO = '2026-02-01T03:30:00.000Z'
const RNG_SEED = 20260801

const CHARGE_KINDS: ChargeKind[] = ['PROCEDURE', 'PHARMACY', 'CONSULTATION', 'TRANSPORT']

/** How many of each ward's beds are forced occupied at the anchor instant.
 * Chosen so the total (8+4+3+2=17) sits mid-band in the required [15,22]
 * active-admissions range, and each value is strictly between 0 and the
 * ward's bed count, so every ward keeps at least one free AND one occupied
 * bed — both are hard requirements, enforced by `setWardOccupancy` in the
 * wind-down phase regardless of what the stochastic simulation left behind. */
const WARD_TARGET_OCCUPANCY: Record<string, number> = {
  GENERAL: 8,
  TWIN: 4,
  PRIVATE: 3,
  ICU: 2,
}

// ---------------------------------------------------------------------
// Pure helpers (no Engine/db access) — all randomness flows through the
// caller-supplied `rng`.
// ---------------------------------------------------------------------

function isoOffsetDays(baseIso: string, days: number): string {
  const d = new Date(baseIso)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString()
}

function pickGender(rng: () => number): 'F' | 'M' | 'O' {
  const r = rng()
  if (r < 0.48) return 'F'
  if (r < 0.96) return 'M'
  return 'O'
}

function randomPersonName(rng: () => number): { name: string; gender: 'F' | 'M' | 'O' } {
  const gender = pickGender(rng)
  const given =
    gender === 'F'
      ? pick(rng, FEMALE_GIVEN_NAMES)
      : gender === 'M'
        ? pick(rng, MALE_GIVEN_NAMES)
        : pick(rng, [...FEMALE_GIVEN_NAMES, ...MALE_GIVEN_NAMES])
  const family = pick(rng, FAMILY_NAMES)
  return { name: `${given} ${family}`, gender }
}

function randomPhone(rng: () => number): string {
  let phone = String(randInt(rng, 6, 9))
  for (let i = 0; i < 9; i++) phone += String(randInt(rng, 0, 9))
  return phone
}

/** Weighted stay length in nights: mostly short stays/day cases, a
 * meaningful minority medium, a few long ICU-style stays — spans the
 * documented 0–20 night range. */
function pickStayNights(rng: () => number): number {
  const r = rng()
  if (r < 0.35) return randInt(rng, 0, 2)
  if (r < 0.8) return randInt(rng, 3, 9)
  return randInt(rng, 10, 20)
}

function normalDepositPaise(rng: () => number, ratePaise: number, nights: number): number {
  const estimatedRoomPaise = ratePaise * Math.max(1, nights)
  const factor = 0.3 + rng() * 0.5 // 30%–80% of the estimated room bill
  return Math.round(estimatedRoomPaise * factor)
}

/** Deliberately exceeds any plausible bill (room + extras) so the resulting
 * discharge produces a refund (balance_paise < 0). */
function refundDepositPaise(rng: () => number, ratePaise: number, nights: number): number {
  const estimatedRoomPaise = ratePaise * Math.max(1, nights)
  const factor = 1.5 + rng() * 1.0 // 150%–250%
  return Math.round(estimatedRoomPaise * factor)
}

/**
 * The deposit used by the wind-down "refund top-up" cycle (see
 * `seedHospital`'s `refundGuard` loop): that cycle always admits and
 * discharges in the same instant with zero extra charges, so its bill is
 * always exactly one night's room rate — this is `refundDepositPaise(rng,
 * ratePaise, 1)` pulled out as its own named, exported, independently
 * testable function (same 150%–250% formula, same single `rng()` draw, so
 * extracting it does not change the seed's RNG consumption sequence or its
 * output — see tests/seed.test.ts's determinism-preservation note).
 *
 * Exported so a property test can assert, independent of the Engine, that
 * this always exceeds a real 1-night/zero-extras bill computed by
 * `computeInvoice` — i.e. the refund top-up path can never accidentally
 * produce a non-refund.
 */
export function refundTopUpDeposit(ratePaise: Paise, rng: () => number): Paise {
  const factor = 1.5 + rng() * 1.0 // 150%–250%
  return Math.round(ratePaise * factor)
}

/**
 * Picks a random element of `pool` whose id is not in `admittedIds`, or
 * `undefined` if every element of `pool` is already admitted (the "soft cap
 * exhausted" case). Pulled out of `seedHospital`'s `pickWaitingPatient`
 * closure as a pure, exported function so the exhaustion path — which the
 * wind-down phase relies on to fall through to registering a fresh patient
 * — is directly unit-testable without running the full six-month
 * simulation. Consumes exactly one `rng()` draw when it returns a pick, and
 * zero when the pool is exhausted — identical to the inlined logic it
 * replaces, so extracting it does not change the seed's RNG consumption
 * sequence.
 */
export function selectAvailable<P extends { id: number }>(
  pool: readonly P[],
  admittedIds: ReadonlySet<number>,
  rng: () => number,
): P | undefined {
  const waiting = pool.filter((p) => !admittedIds.has(p.id))
  return waiting.length > 0 ? pick(rng, waiting) : undefined
}

function chargeAmountPaise(kind: ChargeKind, rng: () => number): number {
  switch (kind) {
    case 'PROCEDURE':
      return randInt(rng, 150_000, 3_000_000) // ₹1,500–₹30,000
    case 'PHARMACY':
      return randInt(rng, 20_000, 600_000) // ₹200–₹6,000
    case 'CONSULTATION':
      return randInt(rng, 30_000, 250_000) // ₹300–₹2,500
    case 'TRANSPORT':
      return randInt(rng, 50_000, 400_000) // ₹500–₹4,000
  }
}

function descriptionFor(kind: ChargeKind, rng: () => number): string {
  switch (kind) {
    case 'PROCEDURE':
      return pick(rng, PROCEDURE_DESCRIPTIONS)
    case 'PHARMACY':
      return pick(rng, PHARMACY_DESCRIPTIONS)
    case 'CONSULTATION':
      return pick(rng, CONSULTATION_DESCRIPTIONS)
    case 'TRANSPORT':
      return pick(rng, TRANSPORT_DESCRIPTIONS)
  }
}

type StaffKind = 'DOCTOR' | 'NURSE' | 'TECHNICIAN' | 'DRIVER' | 'ADMIN'

function buildStaffInput(rng: () => number, kind: StaffKind): StaffInput {
  const { name } = randomPersonName(rng)
  const yearsService = randInt(rng, 1, 25)
  const joinedAt = isoOffsetDays(SEED_START_ISO, -randInt(rng, 180, 6000))

  switch (kind) {
    case 'DOCTOR':
      return {
        name: `Dr. ${name}`,
        type: 'DOCTOR',
        department: pick(rng, DOCTOR_SPECIALTIES),
        base_paise: randInt(rng, 6_000_000, 22_000_000), // ₹60,000–₹2,20,000/mo
        years_service: yearsService,
        specialty: pick(rng, DOCTOR_SPECIALTIES),
        icu_assigned: 0,
        night_shifts: 0,
        on_call: 0,
        joined_at: joinedAt,
      }
    case 'NURSE': {
      const icuAssigned = rng() < 0.4 ? 1 : 0
      return {
        name,
        type: 'NURSE',
        department: icuAssigned ? 'Intensive Care' : pick(rng, DEPARTMENTS),
        base_paise: randInt(rng, 2_800_000, 5_800_000), // ₹28,000–₹58,000/mo
        years_service: yearsService,
        specialty: null,
        icu_assigned: icuAssigned,
        night_shifts: 0,
        on_call: 0,
        joined_at: joinedAt,
      }
    }
    case 'TECHNICIAN':
      return {
        name,
        type: 'TECHNICIAN',
        department: 'Laboratory',
        base_paise: randInt(rng, 2_600_000, 4_400_000), // ₹26,000–₹44,000/mo
        years_service: yearsService,
        specialty: null,
        icu_assigned: 0,
        night_shifts: randInt(rng, 0, 6),
        on_call: 0,
        joined_at: joinedAt,
      }
    case 'DRIVER': {
      const onCall = rng() < 0.5 ? 1 : 0
      return {
        name,
        type: 'DRIVER',
        department: 'Transport',
        base_paise: randInt(rng, 2_400_000, 3_400_000), // ₹24,000–₹34,000/mo
        years_service: yearsService,
        specialty: null,
        icu_assigned: 0,
        night_shifts: 0,
        on_call: onCall,
        joined_at: joinedAt,
      }
    }
    case 'ADMIN':
      return {
        name,
        type: 'ADMIN',
        department: 'Administration',
        base_paise: randInt(rng, 3_000_000, 5_000_000), // ₹30,000–₹50,000/mo
        years_service: yearsService,
        specialty: null,
        icu_assigned: 0,
        night_shifts: 0,
        on_call: 0,
        joined_at: joinedAt,
      }
  }
}

/**
 * bcryptjs's default salt generation pulls from a CSPRNG, so
 * `bcrypt.hashSync(pw, 10)` produces a different hash every run — which
 * would make `db.serialize()` diverge between two otherwise-identical seed
 * runs. This pins `bcrypt.hashSync` to draw from `DEMO_SALTS` (in call
 * order) only for the duration of `fn` — i.e. only while the five
 * DEMO_ACCOUNTS are created — then restores the original implementation, so
 * nothing else is affected. `bcrypt.compareSync` is untouched, so
 * `engine.authenticate` still verifies the real hash against the real
 * plaintext password.
 */
function withFixedDemoSalts<T>(fn: () => T): T {
  const bcrypt = bcryptDefault as unknown as {
    hashSync: (s: string, salt?: string | number) => string
  }
  const original = bcrypt.hashSync
  let i = 0
  bcrypt.hashSync = (s: string) => original(s, DEMO_SALTS[i++ % DEMO_SALTS.length])
  try {
    return fn()
  } finally {
    bcrypt.hashSync = original
  }
}

function requireActor(map: Partial<Record<Role, Actor>>, role: Role): Actor {
  const actor = map[role]
  if (!actor) {
    throw new Error(`seed: demo account for role ${role} was never created`)
  }
  return actor
}

// ---------------------------------------------------------------------
// seedHospital
// ---------------------------------------------------------------------

/**
 * Guards against concurrent `seedHospital()` runs. `withFixedDemoSalts`
 * monkey-patches the module-shared `bcrypt.hashSync` for the duration of
 * DEMO_ACCOUNTS creation; two overlapping runs would race to install/restore
 * that patch and interleave their salt cursors (`DEMO_SALTS[i++]`),
 * corrupting both runs' password hashes and breaking determinism. There is
 * currently no `await` between entering `withFixedDemoSalts` and restoring
 * the original `hashSync`, so today's single-threaded JS can't actually
 * interleave *inside* that block — but `seedHospital` as a whole spans many
 * `await`s (starting with `Db.fresh()`), so nothing stops two calls' async
 * bodies from being in flight at once and both eventually reaching
 * `withFixedDemoSalts`. This flag makes that scenario fail loudly instead
 * of silently, and does so for the whole function (not just the salt
 * patching), since a second full run sharing this module's mutable
 * `bcrypt.hashSync` reference at any point is not something callers should
 * rely on being safe.
 */
let seedInFlight = false

export async function seedHospital(): Promise<SeedResult> {
  if (seedInFlight) {
    throw new Error('seedHospital is not reentrant')
  }
  seedInFlight = true
  try {
    return await runSeedHospital()
  } finally {
    seedInFlight = false
  }
}

async function runSeedHospital(): Promise<SeedResult> {
  const db = await Db.fresh()
  insertFacility(db)

  const clock = new FixedClock(SEED_START_ISO)
  const engine = new Engine(db, clock)
  const rng = mulberry32(RNG_SEED)

  let commandCount = 0
  function cmd<T>(fn: () => T): T {
    commandCount++
    return fn()
  }

  // -- DEMO_ACCOUNTS, created first by the bootstrap actor ---------------
  const roleActors: Partial<Record<Role, Actor>> = {}
  withFixedDemoSalts(() => {
    for (const acc of DEMO_ACCOUNTS) {
      const userId = cmd(() =>
        engine.createUser(BOOTSTRAP, { username: acc.username, password: acc.password, role: acc.role }),
      )
      roleActors[acc.role] = { userId, role: acc.role, username: acc.username }
    }
  })
  const ADMIN = requireActor(roleActors, 'ADMIN')
  const RECEPTION = requireActor(roleActors, 'RECEPTION')
  const DOCTOR = requireActor(roleActors, 'DOCTOR')
  const BILLING = requireActor(roleActors, 'BILLING')

  // -- staff: 6 doctors, 4 nurses, 2 technicians, 2 drivers, 1 admin ------
  const staffPlan: StaffKind[] = [
    'DOCTOR', 'DOCTOR', 'DOCTOR', 'DOCTOR', 'DOCTOR', 'DOCTOR',
    'NURSE', 'NURSE', 'NURSE', 'NURSE',
    'TECHNICIAN', 'TECHNICIAN',
    'DRIVER', 'DRIVER',
    'ADMIN',
  ]
  for (const kind of staffPlan) {
    cmd(() => engine.addStaff(ADMIN, buildStaffInput(rng, kind)))
  }

  // -- facility state used by the simulation ------------------------------
  interface BedInfo {
    id: number
    ward: string
    ratePaise: number
  }
  const bedRows = db.all<{ id: number; ward: string; rate_paise: number }>(
    `SELECT id, ward, rate_paise FROM beds ORDER BY id`,
  )
  const bedById = new Map<number, BedInfo>(
    bedRows.map((b) => [b.id, { id: b.id, ward: b.ward, ratePaise: b.rate_paise }]),
  )
  const freeBedIds = new Set<number>(bedRows.map((b) => b.id))

  const ambulanceIds = db.all<{ id: number }>(`SELECT id FROM ambulances ORDER BY id`).map((r) => r.id)
  const freeAmbulances = new Set<number>(ambulanceIds)
  const dispatchByAmbulance = new Map<number, number>() // ambulanceId -> open dispatchId

  interface PatientProfile {
    id: number
    gender: 'F' | 'M' | 'O'
  }
  const registeredPatients: PatientProfile[] = []
  const admittedPatientIds = new Set<number>()

  interface ActiveAdmissionInfo {
    patientId: number
    bedId: number
    scheduledDischargeIso: string | null
  }
  const activeAdmissions = new Map<number, ActiveAdmissionInfo>()

  let refundCount = 0

  // -- simulation helpers (close over the state above) --------------------

  function registerNextPatient(): PatientProfile {
    const { name, gender } = randomPersonName(rng)
    const dobIso = isoOffsetDays(SEED_START_ISO, -randInt(rng, 365, 365 * 88))
    const phone = randomPhone(rng)
    const idLast4 = String(randInt(rng, 0, 9999)).padStart(4, '0')
    const patientId = cmd(() =>
      engine.registerPatient(RECEPTION, { name, gender, dobIso, phone, idLast4 }),
    )
    const profile: PatientProfile = { id: patientId, gender }
    registeredPatients.push(profile)
    return profile
  }

  function pickWaitingPatient(): PatientProfile | undefined {
    return selectAvailable(registeredPatients, admittedPatientIds, rng)
  }

  /** Always returns a patient who isn't currently admitted, registering a
   * fresh one if the whole existing pool is already in a bed. Used by the
   * wind-down phase, which must succeed unconditionally. */
  function nextAvailablePatient(): PatientProfile {
    return pickWaitingPatient() ?? registerNextPatient()
  }

  function dischargeAdmission(admissionId: number): void {
    const info = activeAdmissions.get(admissionId)
    if (!info) return
    const invoice = cmd(() => engine.discharge(RECEPTION, { admissionId }))
    if (invoice.isRefund) refundCount++
    freeBedIds.add(info.bedId)
    admittedPatientIds.delete(info.patientId)
    activeAdmissions.delete(admissionId)
  }

  function admitPatientIntoBed(
    patient: PatientProfile,
    bedId: number,
    opts: { forceActive?: boolean; boostRefund?: boolean } = {},
  ): number {
    const bed = bedById.get(bedId)
    if (!bed) throw new Error(`admitPatientIntoBed: unknown bed ${bedId}`)

    const stayNights = opts.boostRefund ? 1 : opts.forceActive ? 0 : pickStayNights(rng)
    const diagnosis = pick(rng, DIAGNOSES)
    // `wantRefund`'s short-circuiting is load-bearing for determinism: for
    // opts.boostRefund it never evaluates `rng() < 0.18`, and for
    // opts.forceActive it never evaluates it either — both match the
    // depositPaise branch below exactly, so this refactor draws the same
    // rng() sequence, in the same order, as before it was split out.
    const wantRefund = opts.boostRefund === true || (!opts.forceActive && rng() < 0.18)
    const depositPaise = opts.boostRefund
      ? refundTopUpDeposit(bed.ratePaise, rng) // same formula as refundDepositPaise(rng, ratePaise, 1)
      : wantRefund
        ? refundDepositPaise(rng, bed.ratePaise, Math.max(1, stayNights))
        : normalDepositPaise(rng, bed.ratePaise, Math.max(1, stayNights))

    const admissionId = cmd(() =>
      engine.admit(RECEPTION, { patientId: patient.id, bedId, diagnosis, depositPaise }),
    )
    freeBedIds.delete(bedId)
    admittedPatientIds.add(patient.id)

    let scheduledDischargeIso: string | null = null
    if (!opts.forceActive && !opts.boostRefund) {
      const admittedAtIso = clock.now().toISOString()
      const dischargeDate = new Date(admittedAtIso)
      dischargeDate.setUTCDate(dischargeDate.getUTCDate() + stayNights)
      dischargeDate.setUTCHours(dischargeDate.getUTCHours() + randInt(rng, 0, 20))
      const dischargeIso = dischargeDate.toISOString()
      // Only schedule a discharge that lands before the anchor — an
      // admission whose computed discharge would land on/after it is left
      // open-ended and becomes an "active at anchor" candidate instead.
      if (dischargeIso < ANCHOR_ISO) {
        scheduledDischargeIso = dischargeIso
      }
    }

    activeAdmissions.set(admissionId, { patientId: patient.id, bedId, scheduledDischargeIso })

    if (opts.boostRefund) {
      dischargeAdmission(admissionId)
    }

    return admissionId
  }

  function addRandomCharge(): void {
    const admissionId = pick(rng, [...activeAdmissions.keys()])
    const kind = pick(rng, CHARGE_KINDS)
    const description = descriptionFor(kind, rng)
    const amountPaise = chargeAmountPaise(kind, rng)
    cmd(() => engine.addCharge(DOCTOR, { admissionId, kind, description, amountPaise }))
  }

  function addRandomDeposit(): void {
    const admissionId = pick(rng, [...activeAdmissions.keys()])
    const amountPaise = randInt(rng, 50_000, 1_000_000) // ₹500–₹10,000 top-up
    cmd(() => engine.recordDeposit(BILLING, { admissionId, amountPaise }))
  }

  function doRandomTransfer(): void {
    const admissionId = pick(rng, [...activeAdmissions.keys()])
    const info = activeAdmissions.get(admissionId)
    if (!info) return
    const candidates = [...freeBedIds].filter((id) => id !== info.bedId)
    if (candidates.length === 0) return
    const toBedId = pick(rng, candidates)
    cmd(() => engine.transfer(RECEPTION, { admissionId, toBedId }))
    freeBedIds.delete(toBedId)
    freeBedIds.add(info.bedId)
    activeAdmissions.set(admissionId, { ...info, bedId: toBedId })
  }

  function dispatchRandomAmbulance(): void {
    const ambulanceId = pick(rng, [...freeAmbulances])
    const location = pick(rng, DISPATCH_LOCATIONS)
    const admissionId =
      activeAdmissions.size > 0 && rng() < 0.3
        ? pick(rng, [...activeAdmissions.keys()])
        : undefined
    const dispatchId = cmd(() =>
      engine.dispatchAmbulance(RECEPTION, { ambulanceId, location, admissionId }),
    )
    freeAmbulances.delete(ambulanceId)
    dispatchByAmbulance.set(ambulanceId, dispatchId)
  }

  function returnRandomAmbulance(): void {
    const ambulanceId = pick(rng, [...dispatchByAmbulance.keys()])
    const dispatchId = dispatchByAmbulance.get(ambulanceId)
    if (dispatchId === undefined) return
    cmd(() => engine.returnAmbulance(RECEPTION, { dispatchId }))
    dispatchByAmbulance.delete(ambulanceId)
    freeAmbulances.add(ambulanceId)
  }

  // -- main loop: ~180 days of activity, advancing the clock forward -------

  while (true) {
    const nowIso = clock.now().toISOString()
    if (nowIso >= ANCHOR_ISO) break

    // Discharge anything whose planned stay has come due.
    for (const [admissionId, info] of [...activeAdmissions]) {
      if (info.scheduledDischargeIso !== null && info.scheduledDischargeIso <= nowIso) {
        dischargeAdmission(admissionId)
      }
    }

    // Registration and admission probabilities are tuned so that, across
    // the ~1,450 ticks a ~180-day run produces, the simulation lands close
    // to the documented "~60 patients, ~90 admissions" shape rather than
    // hyper-cycling the same 60 patients through dozens of readmissions
    // each.
    if (registeredPatients.length < 60 && rng() < 0.05) {
      registerNextPatient()
    }

    if (freeBedIds.size > 0 && rng() < 0.08) {
      const patient = pickWaitingPatient()
      if (patient) admitPatientIntoBed(patient, pick(rng, [...freeBedIds]))
    }

    if (activeAdmissions.size > 0 && rng() < 0.45) addRandomCharge()
    if (activeAdmissions.size > 0 && rng() < 0.12) addRandomDeposit()
    if (activeAdmissions.size > 0 && freeBedIds.size > 0 && rng() < 0.06) doRandomTransfer()

    if (freeAmbulances.size > 0 && rng() < 0.04) dispatchRandomAmbulance()
    if (dispatchByAmbulance.size > 0 && rng() < 0.25) returnRandomAmbulance()

    clock.advanceMinutes(randInt(rng, 45, 300))
  }

  // -- wind-down: enforce the shape guarantees exactly, regardless of how
  //    the stochastic phase above happened to land ------------------------

  clock.set(ANCHOR_ISO)

  function occupiedBedsInWard(ward: string): number[] {
    return bedRows.filter((b) => b.ward === ward && !freeBedIds.has(b.id)).map((b) => b.id)
  }
  function freeBedsInWard(ward: string): number[] {
    return bedRows.filter((b) => b.ward === ward && freeBedIds.has(b.id)).map((b) => b.id)
  }
  function admissionIdForBed(bedId: number): number | undefined {
    for (const [admissionId, info] of activeAdmissions) {
      if (info.bedId === bedId) return admissionId
    }
    return undefined
  }
  function setWardOccupancy(ward: string, desired: number): void {
    let occupied = occupiedBedsInWard(ward)
    while (occupied.length > desired) {
      const bedId = occupied[occupied.length - 1]
      const admissionId = admissionIdForBed(bedId)
      if (admissionId === undefined) break
      dischargeAdmission(admissionId)
      occupied = occupiedBedsInWard(ward)
    }
    while (occupied.length < desired) {
      const free = freeBedsInWard(ward)
      if (free.length === 0) break
      admitPatientIntoBed(nextAvailablePatient(), free[0], { forceActive: true })
      occupied = occupiedBedsInWard(ward)
    }
  }

  // Refund top-up: each cycle admits into a currently-free bed with a
  // deliberately excessive deposit and discharges in the same instant, so
  // it nets to zero beds occupied — it never disturbs the ward-occupancy
  // pass that follows.
  let refundGuard = 0
  while (refundCount < 5 && refundGuard < 50) {
    refundGuard++
    if (freeBedIds.size === 0) {
      const anyAdmissionId = [...activeAdmissions.keys()][0]
      if (anyAdmissionId === undefined) break
      dischargeAdmission(anyAdmissionId)
      continue
    }
    const bedId = [...freeBedIds][0]
    admitPatientIntoBed(nextAvailablePatient(), bedId, { boostRefund: true })
  }

  for (const w of WARD_CONFIG) {
    setWardOccupancy(w.ward, WARD_TARGET_OCCUPANCY[w.ward])
  }

  if (dispatchByAmbulance.size === 0) {
    const ambulanceId = ambulanceIds[0]
    const location = pick(rng, DISPATCH_LOCATIONS)
    const dispatchId = cmd(() => engine.dispatchAmbulance(RECEPTION, { ambulanceId, location }))
    freeAmbulances.delete(ambulanceId)
    dispatchByAmbulance.set(ambulanceId, dispatchId)
  }

  clock.set(ANCHOR_ISO)

  return { db, engine, clock, commandCount }
}
