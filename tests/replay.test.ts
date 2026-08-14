import { describe, it, expect } from 'vitest'
import { Db } from '../src/db/database'
import { FixedClock, ANCHOR_ISO } from '../src/core/clock'
import { Engine, type Actor } from '../src/core/engine'
import { rupees } from '../src/core/money'
import { replay, snapshotFromDb, snapshotsEqual, type BedRow } from '../src/core/replay'
import type { EventRow } from '../src/core/events'

const ADMIN: Actor = { userId: 1, role: 'ADMIN', username: 'admin' }

const BEDS: BedRow[] = [
  { id: 1, label: 'B1', ward: 'GENERAL', ratePaise: 100_000 },
  { id: 2, label: 'B2', ward: 'TWIN', ratePaise: 280_000 },
]

/**
 * Runs a scripted ~15-command sequence through the real Engine, covering
 * every EventAction:
 *   PATIENT_REGISTERED x2, STAFF_ADDED, USER_CREATED, ADMITTED x2,
 *   AMBULANCE_DISPATCHED, CHARGE_ADDED x3, DEPOSIT_RECORDED, TRANSFERRED,
 *   DISCHARGED x2 (one normal balance, one over-deposit refund),
 *   AMBULANCE_RETURNED.
 *
 * Returns the db/engine/clock plus a few marker ISO timestamps used by the
 * uptoIso test.
 */
async function runScript() {
  const db = await Db.fresh()
  const clock = new FixedClock(ANCHOR_ISO)
  const engine = new Engine(db, clock)
  db.run(`INSERT INTO beds (id,label,ward,rate_paise) VALUES (1,'B1','GENERAL',100000)`)
  db.run(`INSERT INTO beds (id,label,ward,rate_paise) VALUES (2,'B2','TWIN',280000)`)
  db.run(`INSERT INTO ambulances (id,plate,model) VALUES (1,'AMB1','Force Traveller')`)

  // 1-2: PATIENT_REGISTERED x2
  const p1 = engine.registerPatient(ADMIN, {
    name: 'Asha Rao',
    gender: 'F',
    dobIso: '1990-01-01',
    phone: '9990000001',
    idLast4: '1234',
  })
  const p2 = engine.registerPatient(ADMIN, {
    name: 'Ben Kumar',
    gender: 'M',
    dobIso: '1985-05-05',
    phone: '9990000002',
    idLast4: '5678',
  })

  // 3: STAFF_ADDED
  const staffId = engine.addStaff(ADMIN, {
    name: 'Dr. Meera Iyer',
    type: 'DOCTOR',
    department: 'General Medicine',
    base_paise: 8_000_00,
    years_service: 6,
    specialty: 'Internal Medicine',
    icu_assigned: 0,
    night_shifts: 0,
    on_call: 0,
    joined_at: ANCHOR_ISO,
  })

  // 4: USER_CREATED
  engine.createUser(ADMIN, { username: 'reception1', password: 'pw12345', role: 'RECEPTION' })

  // 5: ADMITTED (admission1, into bed1)
  const admission1 = engine.admit(ADMIN, {
    patientId: p1,
    bedId: 1,
    diagnosis: 'Appendicitis',
    depositPaise: rupees(2000),
  })

  clock.advanceMinutes(30)

  // 6: AMBULANCE_DISPATCHED
  const dispatchId = engine.dispatchAmbulance(ADMIN, {
    ambulanceId: 1,
    location: 'City Center',
    admissionId: admission1,
  })

  clock.advanceMinutes(60)

  // 7: CHARGE_ADDED (procedure)
  engine.addCharge(ADMIN, {
    admissionId: admission1,
    kind: 'PROCEDURE',
    description: 'Appendectomy',
    amountPaise: rupees(12_500),
  })

  clock.advanceMinutes(30)

  // 8: DEPOSIT_RECORDED
  engine.recordDeposit(ADMIN, { admissionId: admission1, amountPaise: rupees(500) })

  clock.advanceMinutes(60)

  // 9: TRANSFERRED (bed1 -> bed2)
  engine.transfer(ADMIN, { admissionId: admission1, toBedId: 2 })

  clock.advanceMinutes(30)

  // 10: CHARGE_ADDED (pharmacy)
  engine.addCharge(ADMIN, {
    admissionId: admission1,
    kind: 'PHARMACY',
    description: 'Medications',
    amountPaise: rupees(1_340.50),
  })

  // Advance past midnight IST a couple of times so admission1 racks up
  // multiple nights (exercises the general nights>1 path).
  clock.advanceMinutes(60 * 50) // ~2 days

  const beforeDischarge1Iso = clock.now().toISOString()

  clock.advanceMinutes(1)

  // 11: DISCHARGED (admission1, normal positive balance)
  engine.discharge(ADMIN, { admissionId: admission1 })

  clock.advanceMinutes(15)

  // 12: ADMITTED (admission2, into bed1 — now free)
  const admission2 = engine.admit(ADMIN, {
    patientId: p2,
    bedId: 1,
    diagnosis: 'Observation',
    depositPaise: rupees(5000),
  })

  clock.advanceMinutes(30)

  // 13: CHARGE_ADDED (small consultation charge)
  engine.addCharge(ADMIN, {
    admissionId: admission2,
    kind: 'CONSULTATION',
    description: 'Consult',
    amountPaise: rupees(200),
  })

  clock.advanceMinutes(30)

  // 14: AMBULANCE_RETURNED
  engine.returnAmbulance(ADMIN, { dispatchId })

  clock.advanceMinutes(60) // same IST calendar day -> 1 night

  // 15: DISCHARGED (admission2, over-deposit refund)
  engine.discharge(ADMIN, { admissionId: admission2 })

  return { db, engine, clock, admission1, admission2, staffId, beforeDischarge1Iso }
}

function chronological(events: EventRow[]): EventRow[] {
  return [...events].sort((a, b) => a.id - b.id)
}

describe('replay', () => {
  it('C2: replay(events, beds) folds the full event log into a Snapshot equal to the live DB, table-for-table', async () => {
    const { db, engine, staffId } = await runScript()
    const events = engine.eventsLog(1_000_000_000)
    // eventsLog returns newest-first; replay sorts defensively, but we also
    // sanity-check the count here.
    expect(events.length).toBe(15)

    const snap = replay(events, BEDS)
    const dbSnap = snapshotFromDb(db)
    const { equal, diff } = snapshotsEqual(snap, dbSnap)
    if (!equal) {
      // eslint-disable-next-line no-console
      console.log('replay/db snapshot diff:\n' + diff.join('\n'))
    }
    expect(equal).toBe(true)
    expect(diff).toEqual([])

    // Spot check: STAFF_ADDED folded correctly (id + a couple of fields).
    expect(snap.staff.get(staffId)?.name).toBe('Dr. Meera Iyer')
    expect(snap.staff.get(staffId)?.years_service).toBe(6)

    // Spot checks: both admissions discharged with invoices present.
    expect(snap.admissions.size).toBe(2)
    expect(snap.invoices.size).toBe(2)
    for (const admission of snap.admissions.values()) {
      expect(admission.status).toBe('DISCHARGED')
    }
    // The over-deposit admission (admission2) must show a refund (negative balance).
    const admission2Invoice = [...snap.invoices.values()].find(
      (inv) => inv.balancePaise < 0,
    )
    expect(admission2Invoice).toBeDefined()
  })

  it('C2: replay is order-independent — passing eventsLog() (newest-first) yields the same Snapshot as chronological order', async () => {
    const { db, engine } = await runScript()
    const eventsDesc = engine.eventsLog(1_000_000_000) // newest-first
    const eventsAsc = chronological(eventsDesc)

    const snapFromDesc = replay(eventsDesc, BEDS)
    const snapFromAsc = replay(eventsAsc, BEDS)
    const { equal, diff } = snapshotsEqual(snapFromDesc, snapFromAsc)
    expect(diff).toEqual([])
    expect(equal).toBe(true)

    const dbSnap = snapshotFromDb(db)
    expect(snapshotsEqual(snapFromDesc, dbSnap).equal).toBe(true)
  })

  it('uptoIso: replaying up to just before a DISCHARGED event leaves that admission ACTIVE with no invoice', async () => {
    const { engine, admission1, beforeDischarge1Iso } = await runScript()
    const events = engine.eventsLog(1_000_000_000)

    const snap = replay(events, BEDS, beforeDischarge1Iso)

    const admission = snap.admissions.get(admission1)
    expect(admission).toBeDefined()
    expect(admission?.status).toBe('ACTIVE')
    expect(admission?.dischargedAt).toBeNull()
    expect(snap.invoices.has(admission1)).toBe(false)

    // admission2 doesn't exist yet at this point in history at all.
    expect(snap.admissions.has(admission1)).toBe(true)
    expect(snap.admissions.size).toBe(1)
  })

  it('discriminating negative: dropping CHARGE_ADDED events makes snapshotsEqual report unequal, with a diff naming the charges table', async () => {
    const { db, engine } = await runScript()
    const events = engine.eventsLog(1_000_000_000)
    const corrupted = events.filter((e) => e.action !== 'CHARGE_ADDED')

    const corruptSnap = replay(corrupted, BEDS)
    const dbSnap = snapshotFromDb(db)
    const { equal, diff } = snapshotsEqual(corruptSnap, dbSnap)

    expect(equal).toBe(false)
    expect(diff.length).toBeGreaterThan(0)
    expect(diff.some((line) => line.startsWith('charges['))).toBe(true)
  })

  it('scope: replay never populates a users map on Snapshot (password hashes never enter the event log)', async () => {
    const { engine } = await runScript()
    const events = engine.eventsLog(1_000_000_000)
    const snap = replay(events, BEDS)
    expect('users' in snap).toBe(false)
  })
})
