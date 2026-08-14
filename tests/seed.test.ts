import { createHash } from 'node:crypto'
import { describe, it, expect, beforeAll } from 'vitest'
import fc from 'fast-check'
import { seedHospital, refundTopUpDeposit, selectAvailable } from '../src/seed/seed'
import { DEMO_ACCOUNTS, DEMO_SALTS } from '../src/seed/facility'
import { replay, snapshotFromDb, snapshotsEqual, type BedRow } from '../src/core/replay'
import { Db } from '../src/db/database'
import { FixedClock, ANCHOR_ISO } from '../src/core/clock'
import { Engine } from '../src/core/engine'
import type { Actor } from '../src/core/engine'
import { mulberry32 } from '../src/core/rng'
import { computeInvoice } from '../src/core/billing'

describe('seedHospital: shape of six months of generated history', () => {
  let seeded: Awaited<ReturnType<typeof seedHospital>>

  beforeAll(async () => {
    seeded = await seedHospital()
  }, 20_000)

  it('lands between 15 and 22 active admissions at the anchor instant', () => {
    const census = seeded.engine.census()
    expect(census.active).toBeGreaterThanOrEqual(15)
    expect(census.active).toBeLessThanOrEqual(22)
  })

  it('leaves every ward with at least one free bed and at least one occupied bed', () => {
    const beds = seeded.engine.beds()
    const wards = [...new Set(beds.map((b) => b.ward))]
    expect(wards.length).toBeGreaterThan(0)
    for (const ward of wards) {
      const wardBeds = beds.filter((b) => b.ward === ward)
      expect(wardBeds.some((b) => !b.occupied), `ward ${ward} has no free bed`).toBe(true)
      expect(wardBeds.some((b) => b.occupied), `ward ${ward} has no occupied bed`).toBe(true)
    }
  })

  it('produces at least 5 refund invoices (balance_paise < 0)', () => {
    const row = seeded.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM invoices WHERE balance_paise < 0`,
    )
    expect(row?.n ?? 0).toBeGreaterThanOrEqual(5)
  })

  it('generates more than 400 events across six months of simulated activity', () => {
    const events = seeded.engine.eventsLog()
    expect(events.length).toBeGreaterThan(400)
    expect(events.length).toBe(seeded.commandCount)
  })

  it('all five demo accounts authenticate with their documented passwords and roles', () => {
    for (const acc of DEMO_ACCOUNTS) {
      const actor = seeded.engine.authenticate(acc.username, acc.password)
      expect(actor.role).toBe(acc.role)
      expect(actor.username).toBe(acc.username)
    }
  })

  it('rejects a wrong password for a demo account (sanity check that hashes are real, not stubbed)', () => {
    expect(() => seeded.engine.authenticate('admin', 'not-the-password')).toThrow()
  })

  it('no event payload contains "password" or the bcrypt hash prefix "$2"', () => {
    const events = seeded.engine.eventsLog()
    expect(events.length).toBeGreaterThan(0)
    for (const e of events) {
      expect(e.payload.toLowerCase()).not.toContain('password')
      expect(e.payload).not.toContain('$2')
    }
  })

  it('C2 at scale: replay(events, beds) folds the full six-month event log into a Snapshot equal to the live DB', () => {
    const { db, engine } = seeded
    const bedRows: BedRow[] = db
      .all<{ id: number; label: string; ward: string; rate_paise: number }>(
        `SELECT id, label, ward, rate_paise FROM beds`,
      )
      .map((r) => ({ id: r.id, label: r.label, ward: r.ward, ratePaise: r.rate_paise }))
    const events = engine.eventsLog()

    const snap = replay(events, bedRows)
    const dbSnap = snapshotFromDb(db)
    const { equal, diff } = snapshotsEqual(snap, dbSnap)
    if (!equal) {
      // eslint-disable-next-line no-console
      console.log('seed replay/db snapshot diff:\n' + diff.join('\n'))
    }
    expect(diff).toEqual([])
    expect(equal).toBe(true)
  })

  it('bootstraps DEMO_ACCOUNTS via the documented userId:0 system actor', () => {
    const events = seeded.engine.eventsLog()
    const userCreatedEvents = events.filter((e) => e.action === 'USER_CREATED')
    expect(userCreatedEvents.length).toBe(DEMO_ACCOUNTS.length)
    // The very first USER_CREATED event (chronologically) is stamped by the
    // bootstrap actor, userId 0 — there is no earlier user to attribute it to.
    const chronological = [...userCreatedEvents].sort((a, b) => a.id - b.id)
    expect(chronological[0].actorUserId).toBe(0)
  })
})

describe('seedHospital: determinism', () => {
  it('two independent runs produce byte-identical serialized databases (SHA-256)', async () => {
    const a = await seedHospital()
    const b = await seedHospital()
    const hashA = createHash('sha256').update(a.db.serialize()).digest('hex')
    const hashB = createHash('sha256').update(b.db.serialize()).digest('hex')
    expect(hashA).toBe(hashB)
  }, 30_000)

  it('the fixed demo salts actually produce identical bcrypt output across two hashSync calls', async () => {
    const bcrypt = (await import('bcryptjs')).default
    const salt = DEMO_SALTS[0]
    const h1 = bcrypt.hashSync('probe-password', salt)
    const h2 = bcrypt.hashSync('probe-password', salt)
    expect(h1).toBe(h2)
    expect(h1.startsWith('$2')).toBe(true)
  })
})

describe('seedHospital: reentrancy guard', () => {
  it('a second concurrent call rejects while the first is in flight, and a later sequential call still succeeds', async () => {
    // Start both without awaiting the first — this is exactly the scenario
    // the guard exists for: two overlapping runs racing to install/restore
    // the shared bcrypt.hashSync monkey-patch (see withFixedDemoSalts).
    const first = seedHospital()
    const second = seedHospital()

    await expect(second).rejects.toThrow('seedHospital is not reentrant')

    const firstResult = await first
    expect(firstResult.commandCount).toBeGreaterThan(0)

    // The in-flight flag must be released once the first run settles (it's
    // reset in a `finally`) — prove a later, purely sequential call is
    // unaffected by the earlier rejection.
    const third = await seedHospital()
    expect(third.commandCount).toBeGreaterThan(0)
  }, 30_000)
})

describe('seedHospital: safety-net paths are directly exercised, not just dormant', () => {
  describe('refundTopUpDeposit — the wind-down refund top-up cycle', () => {
    it('always exceeds a real 1-night, zero-extras bill, for any rate and any rng draw (property test)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10_000_00 }), // ratePaise: ₹1 – ₹1,00,000 per night
          fc.integer({ min: 0, max: 0xffffffff }), // mulberry32 seed
          (ratePaise, seed) => {
            const rng = mulberry32(seed)
            const deposit = refundTopUpDeposit(ratePaise, rng)

            // The real bill an identical, same-instant admit+discharge with
            // zero extra charges would produce, computed the same way the
            // Engine computes it.
            const bill = computeInvoice({
              admittedAtIso: ANCHOR_ISO,
              dischargedAtIso: ANCHOR_ISO,
              roomRatePaise: ratePaise,
              lines: [],
              depositPaise: 0,
            })

            expect(deposit).toBeGreaterThan(bill.roomTotalPaise + bill.extrasTotalPaise)
          },
        ),
      )
    })

    it('drives a real same-instant admit+discharge through the Engine to an actual refund invoice', async () => {
      const db = await Db.fresh()
      db.run(`INSERT INTO beds (label, ward, rate_paise) VALUES ('T-01','TWIN',280000)`)
      const bedId = db.lastId()
      const clock = new FixedClock(ANCHOR_ISO)
      const engine = new Engine(db, clock)
      const RECEPTION: Actor = { userId: 1, role: 'RECEPTION', username: 'reception' }

      const patientId = engine.registerPatient(RECEPTION, {
        name: 'Refund Probe',
        gender: 'F',
        dobIso: '1990-01-01',
        phone: '9000000000',
        idLast4: '0001',
      })

      const rng = mulberry32(42)
      const depositPaise = refundTopUpDeposit(280000, rng)
      const admissionId = engine.admit(RECEPTION, {
        patientId,
        bedId,
        diagnosis: 'Observation',
        depositPaise,
      })
      // Same instant — no clock.advanceMinutes() — matches the wind-down's
      // refund top-up cycle exactly (admit and discharge share one tick).
      const invoice = engine.discharge(RECEPTION, { admissionId })

      expect(invoice.isRefund).toBe(true)
      expect(invoice.balancePaise).toBeLessThan(0)

      const row = db.get<{ balance_paise: number }>(
        `SELECT balance_paise FROM invoices WHERE admission_id = ?`,
        [admissionId],
      )
      expect(row?.balance_paise).toBeLessThan(0)
    })
  })

  describe('selectAvailable — the beyond-cap registration fallback', () => {
    it('picks a waiting (not-yet-admitted) element from the pool', () => {
      const pool = [{ id: 1 }, { id: 2 }, { id: 3 }]
      const admitted = new Set([1, 3])
      const rng = mulberry32(7)
      const picked = selectAvailable(pool, admitted, rng)
      expect(picked).toEqual({ id: 2 })
    })

    it('returns undefined once every pool member is admitted — the soft-cap-exhausted case', () => {
      const pool = [{ id: 1 }, { id: 2 }]
      const admitted = new Set([1, 2])
      const rng = mulberry32(7)
      expect(selectAvailable(pool, admitted, rng)).toBeUndefined()
    })

    it('exercises the beyond-cap fallback: an exhausted pool falls through to registering a genuinely new patient via the Engine', async () => {
      const db = await Db.fresh()
      const clock = new FixedClock(ANCHOR_ISO)
      const engine = new Engine(db, clock)
      const RECEPTION: Actor = { userId: 1, role: 'RECEPTION', username: 'reception' }

      const existingId = engine.registerPatient(RECEPTION, {
        name: 'Already Admitted',
        gender: 'M',
        dobIso: '1980-01-01',
        phone: '9111111111',
        idLast4: '1111',
      })
      const pool = [{ id: existingId }]
      const admitted = new Set([existingId]) // the entire soft-cap pool is exhausted

      const rng = mulberry32(99)
      // Mirrors seed.ts's `nextAvailablePatient`:
      // `pickWaitingPatient() ?? registerNextPatient()`.
      const picked =
        selectAvailable(pool, admitted, rng) ??
        (() => {
          const id = engine.registerPatient(RECEPTION, {
            name: 'Overflow Patient',
            gender: 'F',
            dobIso: '1990-01-01',
            phone: '9222222222',
            idLast4: '2222',
          })
          return { id }
        })()

      expect(picked.id).not.toBe(existingId)
      expect(engine.patients().some((p) => p.id === picked.id)).toBe(true)
      expect(engine.patients().length).toBe(2)
    })
  })
})
