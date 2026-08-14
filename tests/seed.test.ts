import { createHash } from 'node:crypto'
import { describe, it, expect, beforeAll } from 'vitest'
import { seedHospital } from '../src/seed/seed'
import { DEMO_ACCOUNTS, DEMO_SALTS } from '../src/seed/facility'
import { replay, snapshotFromDb, snapshotsEqual, type BedRow } from '../src/core/replay'

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
