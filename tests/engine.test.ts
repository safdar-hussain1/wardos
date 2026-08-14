import { describe, it, expect } from 'vitest'
import { Db } from '../src/db/database'
import { FixedClock, ANCHOR_ISO } from '../src/core/clock'
import { Engine, type Actor } from '../src/core/engine'
import { RuleViolationError } from '../src/core/errors'
import { rupees } from '../src/core/money'
import { computeInvoice } from '../src/core/billing'

const ADMIN: Actor = { userId: 1, role: 'ADMIN', username: 'admin' }

/** Fresh db + engine wired to a FixedClock, with two beds and one ambulance seeded. */
async function setup() {
  const db = await Db.fresh()
  const clock = new FixedClock(ANCHOR_ISO)
  const engine = new Engine(db, clock)
  db.run(`INSERT INTO beds (id,label,ward,rate_paise) VALUES (1,'B1','GENERAL',100000)`)
  db.run(`INSERT INTO beds (id,label,ward,rate_paise) VALUES (2,'B2','GENERAL',100000)`)
  db.run(`INSERT INTO ambulances (id,plate,model) VALUES (1,'AMB1','Force Traveller')`)
  return { db, clock, engine }
}

function eventCount(db: Db): number {
  return db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM events`)!.n
}

describe('Engine', () => {
  describe('registerPatient / MRN', () => {
    it('assigns MRN in WH-NNNN format, zero-padded to 4', async () => {
      const { db, engine } = await setup()
      const id1 = engine.registerPatient(ADMIN, {
        name: 'Asha Rao',
        gender: 'F',
        dobIso: '1990-01-01',
        phone: '9990000001',
        idLast4: '1234',
      })
      const id2 = engine.registerPatient(ADMIN, {
        name: 'Ben Kumar',
        gender: 'M',
        dobIso: '1985-05-05',
        phone: '9990000002',
        idLast4: '5678',
      })
      const p1 = db.get<{ mrn: string }>(`SELECT mrn FROM patients WHERE id = ?`, [id1])
      const p2 = db.get<{ mrn: string }>(`SELECT mrn FROM patients WHERE id = ?`, [id2])
      expect(p1?.mrn).toBe('WH-0001')
      expect(p2?.mrn).toBe('WH-0002')
    })

    it('appends a PATIENT_REGISTERED event with the derived patientId and mrn', async () => {
      const { db, engine } = await setup()
      const id = engine.registerPatient(ADMIN, {
        name: 'Asha Rao',
        gender: 'F',
        dobIso: '1990-01-01',
        phone: '9990000001',
        idLast4: '1234',
      })
      const ev = db.get<{ action: string; payload: string }>(`SELECT action, payload FROM events`)
      expect(ev?.action).toBe('PATIENT_REGISTERED')
      const payload = JSON.parse(ev!.payload)
      expect(payload.patientId).toBe(id)
      expect(payload.mrn).toBe('WH-0001')
      expect(payload.name).toBe('Asha Rao')
    })
  })

  describe('admit — rule violations', () => {
    it('admitting onto an occupied bed throws RuleViolationError("bed is occupied")', async () => {
      const { engine } = await setup()
      const p1 = engine.registerPatient(ADMIN, {
        name: 'P1',
        gender: 'F',
        dobIso: '1990-01-01',
        phone: '1',
        idLast4: '1234',
      })
      const p2 = engine.registerPatient(ADMIN, {
        name: 'P2',
        gender: 'M',
        dobIso: '1990-01-01',
        phone: '2',
        idLast4: '5678',
      })
      engine.admit(ADMIN, { patientId: p1, bedId: 1, diagnosis: 'x', depositPaise: rupees(1000) })
      expect(() =>
        engine.admit(ADMIN, { patientId: p2, bedId: 1, diagnosis: 'y', depositPaise: rupees(1000) }),
      ).toThrow(RuleViolationError)
      expect(() =>
        engine.admit(ADMIN, { patientId: p2, bedId: 1, diagnosis: 'y', depositPaise: rupees(1000) }),
      ).toThrow(/bed is occupied/)
    })

    it('admitting a patient who is already admitted throws RuleViolationError', async () => {
      const { engine } = await setup()
      const p1 = engine.registerPatient(ADMIN, {
        name: 'P1',
        gender: 'F',
        dobIso: '1990-01-01',
        phone: '1',
        idLast4: '1234',
      })
      engine.admit(ADMIN, { patientId: p1, bedId: 1, diagnosis: 'x', depositPaise: rupees(1000) })
      expect(() =>
        engine.admit(ADMIN, { patientId: p1, bedId: 2, diagnosis: 'y', depositPaise: rupees(1000) }),
      ).toThrow(RuleViolationError)
    })
  })

  describe('event appended in the same transaction as the mutation', () => {
    it('a successful command appends exactly one event', async () => {
      const { db, engine } = await setup()
      const before = eventCount(db)
      engine.registerPatient(ADMIN, {
        name: 'P1',
        gender: 'F',
        dobIso: '1990-01-01',
        phone: '1',
        idLast4: '1234',
      })
      expect(eventCount(db)).toBe(before + 1)
    })

    it('a rule violation that fires before the event insert persists no event and no partial mutation', async () => {
      const { db, engine } = await setup()
      const p1 = engine.registerPatient(ADMIN, {
        name: 'P1',
        gender: 'F',
        dobIso: '1990-01-01',
        phone: '1',
        idLast4: '1234',
      })
      const p2 = engine.registerPatient(ADMIN, {
        name: 'P2',
        gender: 'M',
        dobIso: '1990-01-01',
        phone: '2',
        idLast4: '5678',
      })
      engine.admit(ADMIN, { patientId: p1, bedId: 1, diagnosis: 'x', depositPaise: rupees(1000) })

      const before = eventCount(db)
      expect(() =>
        engine.admit(ADMIN, { patientId: p2, bedId: 1, diagnosis: 'y', depositPaise: rupees(1000) }),
      ).toThrow(RuleViolationError)
      expect(eventCount(db)).toBe(before) // no event from the failed admit
      const admissionsForP2 = db.all(`SELECT * FROM admissions WHERE patient_id = ?`, [p2])
      expect(admissionsForP2).toHaveLength(0) // no partial admission row either
    })

    // The test above forces a failure *before* appendEvent ever runs, so it can't
    // tell apart "events are written inside the tx" from "events are written
    // outside the tx, but this command just never gets that far". This test
    // instead forces the failure *after* a real, successful `INSERT INTO events`
    // — by wrapping db.run to let the events insert through and then throw — so
    // it only passes if the event row and the mutation are rolled back together,
    // which can only happen if appendEvent runs inside the same db.inTransaction
    // as the mutation.
    it('a failure injected right after a successful event insert rolls back both the event and the mutation (proves same-tx atomicity)', async () => {
      const { db, engine } = await setup()
      const originalRun = db.run.bind(db)
      let sawEventInsert = false
      db.run = (sql: string, params?: unknown[]): void => {
        if (/INSERT INTO events/.test(sql)) {
          sawEventInsert = true
          originalRun(sql, params) // let the event actually get written...
          throw new Error('injected failure right after the event insert succeeded')
        }
        originalRun(sql, params)
      }

      const before = eventCount(db)
      try {
        expect(() =>
          engine.registerPatient(ADMIN, {
            name: 'Injected',
            gender: 'F',
            dobIso: '1990-01-01',
            phone: '1',
            idLast4: '1234',
          }),
        ).toThrow('injected failure right after the event insert succeeded')
        expect(sawEventInsert).toBe(true) // the injection point was actually reached
      } finally {
        db.run = originalRun // restore before further queries/tests
      }

      expect(eventCount(db)).toBe(before) // the "successful" event insert was rolled back too
      const patients = db.all(`SELECT * FROM patients WHERE name = 'Injected'`)
      expect(patients).toHaveLength(0) // and so was the patient row
    })
  })

  describe('event payloads never leak credentials', () => {
    it('no event payload contains "password" or the bcrypt hash prefix "$2"', async () => {
      const { db, engine } = await setup()
      const p1 = engine.registerPatient(ADMIN, {
        name: 'P1',
        gender: 'F',
        dobIso: '1990-01-01',
        phone: '1',
        idLast4: '1234',
      })
      engine.admit(ADMIN, { patientId: p1, bedId: 1, diagnosis: 'x', depositPaise: rupees(1000) })
      engine.createUser(ADMIN, { username: 'nurse1', password: 'super-secret-pw', role: 'NURSE' })

      const rows = db.all<{ payload: string }>(`SELECT payload FROM events`)
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        expect(row.payload).not.toMatch(/password/i)
        expect(row.payload).not.toContain('$2')
        expect(row.payload).not.toContain('super-secret-pw')
      }
    })

    it('USER_CREATED payload is exactly {username, role, staffId}', async () => {
      const { db, engine } = await setup()
      engine.createUser(ADMIN, { username: 'nurse1', password: 'super-secret-pw', role: 'NURSE' })
      const ev = db.get<{ payload: string }>(`SELECT payload FROM events WHERE action = 'USER_CREATED'`)
      const payload = JSON.parse(ev!.payload)
      expect(Object.keys(payload).sort()).toEqual(['role', 'staffId', 'username'])
      expect(payload.username).toBe('nurse1')
      expect(payload.role).toBe('NURSE')
      expect(payload.staffId).toBeNull()
    })
  })

  describe('authenticate', () => {
    it('succeeds with the correct password and returns an Actor', async () => {
      const { engine } = await setup()
      engine.createUser(ADMIN, { username: 'nurse1', password: 'correct-horse', role: 'NURSE' })
      const actor = engine.authenticate('nurse1', 'correct-horse')
      expect(actor.username).toBe('nurse1')
      expect(actor.role).toBe('NURSE')
      expect(typeof actor.userId).toBe('number')
    })

    it('throws the same generic error for wrong password as for unknown username', async () => {
      const { engine } = await setup()
      engine.createUser(ADMIN, { username: 'nurse1', password: 'correct-horse', role: 'NURSE' })
      let wrongPasswordMsg = ''
      let unknownUserMsg = ''
      try {
        engine.authenticate('nurse1', 'wrong-password')
      } catch (e) {
        wrongPasswordMsg = (e as Error).message
      }
      try {
        engine.authenticate('ghost', 'whatever')
      } catch (e) {
        unknownUserMsg = (e as Error).message
      }
      expect(wrongPasswordMsg).toBe('invalid credentials')
      expect(unknownUserMsg).toBe('invalid credentials')
      expect(wrongPasswordMsg).toBe(unknownUserMsg)
    })
  })

  describe('admit → discharge golden cycle', () => {
    it('discharge computes the invoice via computeInvoice from real charges and freezes it', async () => {
      const { db, engine, clock } = await setup()
      const patientId = engine.registerPatient(ADMIN, {
        name: 'Golden Patient',
        gender: 'F',
        dobIso: '1990-01-01',
        phone: '1',
        idLast4: '1234',
      })
      const admittedAt = clock.now().toISOString()
      const admissionId = engine.admit(ADMIN, {
        patientId,
        bedId: 1,
        diagnosis: 'observation',
        depositPaise: rupees(2000),
      })

      engine.addCharge(ADMIN, {
        admissionId,
        kind: 'PHARMACY',
        description: 'aspirin',
        amountPaise: rupees(150),
      })
      engine.addCharge(ADMIN, {
        admissionId,
        kind: 'CONSULTATION',
        description: 'doctor visit',
        amountPaise: rupees(500),
      })

      clock.advanceMinutes(60 * 50) // ~2 IST calendar days later
      const dischargedAt = clock.now().toISOString()

      const invoice = engine.discharge(ADMIN, { admissionId })

      const expected = computeInvoice({
        admittedAtIso: admittedAt,
        dischargedAtIso: dischargedAt,
        roomRatePaise: rupees(1000), // bed 1's rate_paise = 100000
        lines: [
          { kind: 'PHARMACY', description: 'aspirin', amountPaise: rupees(150) },
          { kind: 'CONSULTATION', description: 'doctor visit', amountPaise: rupees(500) },
        ],
        depositPaise: rupees(2000),
      })
      expect(invoice).toEqual(expected)

      // The invoice row persisted in the db matches the returned/computed invoice.
      const row = db.get<{
        nights: number
        room_rate_paise: number
        room_total_paise: number
        extras_total_paise: number
        deposit_paise: number
        balance_paise: number
      }>(`SELECT * FROM invoices WHERE admission_id = ?`, [admissionId])
      expect(row?.nights).toBe(expected.nights)
      expect(row?.room_rate_paise).toBe(expected.roomRatePaise)
      expect(row?.room_total_paise).toBe(expected.roomTotalPaise)
      expect(row?.extras_total_paise).toBe(expected.extrasTotalPaise)
      expect(row?.deposit_paise).toBe(expected.depositPaise)
      expect(row?.balance_paise).toBe(expected.balancePaise)

      // Admission flipped to DISCHARGED.
      const admission = db.get<{ status: string; discharged_at: string | null }>(
        `SELECT status, discharged_at FROM admissions WHERE id = ?`,
        [admissionId],
      )
      expect(admission?.status).toBe('DISCHARGED')
      expect(admission?.discharged_at).toBe(dischargedAt)

      // DISCHARGED event appended.
      const ev = db.get<{ action: string }>(
        `SELECT action FROM events WHERE entity = 'admission' AND entity_id = ? AND action = 'DISCHARGED'`,
        [admissionId],
      )
      expect(ev).toBeDefined()
    })

    it('discharging an already-discharged admission throws RuleViolationError', async () => {
      const { engine } = await setup()
      const patientId = engine.registerPatient(ADMIN, {
        name: 'P1',
        gender: 'F',
        dobIso: '1990-01-01',
        phone: '1',
        idLast4: '1234',
      })
      const admissionId = engine.admit(ADMIN, {
        patientId,
        bedId: 1,
        diagnosis: 'x',
        depositPaise: rupees(1000),
      })
      engine.discharge(ADMIN, { admissionId })
      expect(() => engine.discharge(ADMIN, { admissionId })).toThrow(RuleViolationError)
    })
  })

  describe('ambulance dispatch / return', () => {
    it('returning an already-returned dispatch throws RuleViolationError', async () => {
      const { engine } = await setup()
      const dispatchId = engine.dispatchAmbulance(ADMIN, { ambulanceId: 1, location: 'Sector 5' })
      engine.returnAmbulance(ADMIN, { dispatchId })
      expect(() => engine.returnAmbulance(ADMIN, { dispatchId })).toThrow(RuleViolationError)
    })

    it('dispatching an ambulance that already has an open dispatch throws RuleViolationError', async () => {
      const { engine } = await setup()
      engine.dispatchAmbulance(ADMIN, { ambulanceId: 1, location: 'Sector 5' })
      expect(() =>
        engine.dispatchAmbulance(ADMIN, { ambulanceId: 1, location: 'Sector 9' }),
      ).toThrow(RuleViolationError)
    })
  })

  describe('queries', () => {
    it('beds() reports occupancy and patient name for occupied beds', async () => {
      const { engine } = await setup()
      const patientId = engine.registerPatient(ADMIN, {
        name: 'Occupant',
        gender: 'F',
        dobIso: '1990-01-01',
        phone: '1',
        idLast4: '1234',
      })
      engine.admit(ADMIN, { patientId, bedId: 1, diagnosis: 'x', depositPaise: rupees(1000) })
      const beds = engine.beds()
      expect(beds).toHaveLength(2)
      const bed1 = beds.find((b) => b.id === 1)
      const bed2 = beds.find((b) => b.id === 2)
      expect(bed1?.occupied).toBe(true)
      expect(bed1?.patientName).toBe('Occupant')
      expect(bed2?.occupied).toBe(false)
      expect(bed2?.patientName).toBeUndefined()
    })

    it('census() reflects active admissions and free beds', async () => {
      const { engine } = await setup()
      const patientId = engine.registerPatient(ADMIN, {
        name: 'P1',
        gender: 'F',
        dobIso: '1990-01-01',
        phone: '1',
        idLast4: '1234',
      })
      engine.admit(ADMIN, { patientId, bedId: 1, diagnosis: 'x', depositPaise: rupees(1000) })
      const census = engine.census()
      expect(census).toEqual({ patients: 1, active: 1, bedsTotal: 2, bedsFree: 1 })
    })

    it('eventsLog returns newest-first', async () => {
      const { engine } = await setup()
      engine.registerPatient(ADMIN, {
        name: 'P1',
        gender: 'F',
        dobIso: '1990-01-01',
        phone: '1',
        idLast4: '1234',
      })
      engine.registerPatient(ADMIN, {
        name: 'P2',
        gender: 'M',
        dobIso: '1990-01-01',
        phone: '2',
        idLast4: '5678',
      })
      const log = engine.eventsLog()
      expect(log.length).toBe(2)
      expect(log[0].id).toBeGreaterThan(log[1].id)
    })

    it('patients() filters by name/mrn substring', async () => {
      const { engine } = await setup()
      engine.registerPatient(ADMIN, {
        name: 'Asha Rao',
        gender: 'F',
        dobIso: '1990-01-01',
        phone: '1',
        idLast4: '1234',
      })
      engine.registerPatient(ADMIN, {
        name: 'Ben Kumar',
        gender: 'M',
        dobIso: '1990-01-01',
        phone: '2',
        idLast4: '5678',
      })
      expect(engine.patients('Asha')).toHaveLength(1)
      expect(engine.patients('WH-0002')).toHaveLength(1)
      expect(engine.patients()).toHaveLength(2)
    })

    it('admissionsActive() lists only ACTIVE admissions with patient/bed labels', async () => {
      const { engine } = await setup()
      const patientId = engine.registerPatient(ADMIN, {
        name: 'P1',
        gender: 'F',
        dobIso: '1990-01-01',
        phone: '1',
        idLast4: '1234',
      })
      const admissionId = engine.admit(ADMIN, {
        patientId,
        bedId: 1,
        diagnosis: 'x',
        depositPaise: rupees(1000),
      })
      const active = engine.admissionsActive()
      expect(active).toHaveLength(1)
      expect(active[0]).toMatchObject({ id: admissionId, patientName: 'P1', bedLabel: 'B1' })

      engine.discharge(ADMIN, { admissionId })
      expect(engine.admissionsActive()).toHaveLength(0)
    })

    it('ambulances() reports the open dispatch when one exists', async () => {
      const { engine } = await setup()
      expect(engine.ambulances()[0].openDispatch).toBeUndefined()
      const dispatchId = engine.dispatchAmbulance(ADMIN, { ambulanceId: 1, location: 'Sector 5' })
      const amb = engine.ambulances()[0]
      expect(amb.openDispatch?.id).toBe(dispatchId)
      expect(amb.openDispatch?.location).toBe('Sector 5')
      engine.returnAmbulance(ADMIN, { dispatchId })
      expect(engine.ambulances()[0].openDispatch).toBeUndefined()
    })

    it('billPreview uses the clock for an ACTIVE admission and invoiceFor freezes after discharge', async () => {
      const { engine, clock } = await setup()
      const patientId = engine.registerPatient(ADMIN, {
        name: 'P1',
        gender: 'F',
        dobIso: '1990-01-01',
        phone: '1',
        idLast4: '1234',
      })
      const admissionId = engine.admit(ADMIN, {
        patientId,
        bedId: 1,
        diagnosis: 'x',
        depositPaise: rupees(1000),
      })
      const preview = engine.billPreview(admissionId)
      expect(preview.nights).toBe(1)

      clock.advanceMinutes(60 * 30)
      const invoice = engine.discharge(ADMIN, { admissionId })
      const frozen = engine.invoiceFor(admissionId)
      expect(frozen).toBeDefined()
      expect(frozen?.balancePaise).toBe(invoice.balancePaise)
      expect(frozen?.nights).toBe(invoice.nights)

      // Once DISCHARGED, billPreview returns the frozen invoice shape (sans issuedAt).
      const previewAfter = engine.billPreview(admissionId)
      expect(previewAfter).toEqual({
        nights: frozen!.nights,
        roomRatePaise: frozen!.roomRatePaise,
        roomTotalPaise: frozen!.roomTotalPaise,
        lines: frozen!.lines,
        extrasTotalPaise: frozen!.extrasTotalPaise,
        depositPaise: frozen!.depositPaise,
        balancePaise: frozen!.balancePaise,
        isRefund: frozen!.isRefund,
        refundPaise: frozen!.refundPaise,
      })
    })

    it('payroll() sums monthlyPay for all staff', async () => {
      const { db, engine } = await setup()
      db.run(
        `INSERT INTO staff (name,type,department,base_paise,years_service,specialty,icu_assigned,night_shifts,on_call,joined_at)
         VALUES ('Dr. A','DOCTOR','Cardiology',18000000,6,'Cardiology',0,0,0,'2020-01-01T00:00:00.000Z')`,
      )
      const payroll = engine.payroll()
      expect(payroll.rows).toHaveLength(1)
      expect(payroll.rows[0].monthlyPaise).toBe(25_200_000)
      expect(payroll.totalPaise).toBe(25_200_000)
    })
  })

  describe('recordDeposit', () => {
    it('adds to (does not replace) the existing deposit', async () => {
      const { db, engine } = await setup()
      const patientId = engine.registerPatient(ADMIN, {
        name: 'P1',
        gender: 'F',
        dobIso: '1990-01-01',
        phone: '1',
        idLast4: '1234',
      })
      const admissionId = engine.admit(ADMIN, {
        patientId,
        bedId: 1,
        diagnosis: 'x',
        depositPaise: rupees(1000),
      })
      engine.recordDeposit(ADMIN, { admissionId, amountPaise: rupees(500) })
      const row = db.get<{ deposit_paise: number }>(`SELECT deposit_paise FROM admissions WHERE id = ?`, [
        admissionId,
      ])
      expect(row?.deposit_paise).toBe(rupees(1500))
    })
  })

  describe('money boundary validation (admit.depositPaise, recordDeposit.amountPaise, addCharge.amountPaise)', () => {
    const BAD_AMOUNTS = [1.5, -100, NaN]

    for (const bad of BAD_AMOUNTS) {
      it(`admit rejects depositPaise=${bad} with RuleViolationError and persists nothing`, async () => {
        const { db, engine } = await setup()
        const patientId = engine.registerPatient(ADMIN, {
          name: 'P1',
          gender: 'F',
          dobIso: '1990-01-01',
          phone: '1',
          idLast4: '1234',
        })
        const before = eventCount(db)
        expect(() =>
          engine.admit(ADMIN, { patientId, bedId: 1, diagnosis: 'x', depositPaise: bad }),
        ).toThrow(RuleViolationError)
        expect(eventCount(db)).toBe(before)
        expect(db.all(`SELECT * FROM admissions`)).toHaveLength(0)
      })

      it(`recordDeposit rejects amountPaise=${bad} with RuleViolationError and leaves the deposit unchanged`, async () => {
        const { db, engine } = await setup()
        const patientId = engine.registerPatient(ADMIN, {
          name: 'P1',
          gender: 'F',
          dobIso: '1990-01-01',
          phone: '1',
          idLast4: '1234',
        })
        const admissionId = engine.admit(ADMIN, {
          patientId,
          bedId: 1,
          diagnosis: 'x',
          depositPaise: rupees(1000),
        })
        const before = eventCount(db)
        expect(() => engine.recordDeposit(ADMIN, { admissionId, amountPaise: bad })).toThrow(
          RuleViolationError,
        )
        expect(eventCount(db)).toBe(before)
        const row = db.get<{ deposit_paise: number }>(
          `SELECT deposit_paise FROM admissions WHERE id = ?`,
          [admissionId],
        )
        expect(row?.deposit_paise).toBe(rupees(1000)) // unchanged
      })

      it(`addCharge rejects amountPaise=${bad} with RuleViolationError and persists no charge/event`, async () => {
        const { db, engine } = await setup()
        const patientId = engine.registerPatient(ADMIN, {
          name: 'P1',
          gender: 'F',
          dobIso: '1990-01-01',
          phone: '1',
          idLast4: '1234',
        })
        const admissionId = engine.admit(ADMIN, {
          patientId,
          bedId: 1,
          diagnosis: 'x',
          depositPaise: rupees(1000),
        })
        const before = eventCount(db)
        expect(() =>
          engine.addCharge(ADMIN, {
            admissionId,
            kind: 'PHARMACY',
            description: 'x',
            amountPaise: bad,
          }),
        ).toThrow(RuleViolationError)
        expect(eventCount(db)).toBe(before)
        expect(db.all(`SELECT * FROM charges WHERE admission_id = ?`, [admissionId])).toHaveLength(0)
      })
    }

    it('rejects with the exact mandated message', async () => {
      const { engine } = await setup()
      const patientId = engine.registerPatient(ADMIN, {
        name: 'P1',
        gender: 'F',
        dobIso: '1990-01-01',
        phone: '1',
        idLast4: '1234',
      })
      expect(() =>
        engine.admit(ADMIN, { patientId, bedId: 1, diagnosis: 'x', depositPaise: -1 }),
      ).toThrow('amount must be a non-negative integer amount in paise')
    })
  })

  describe('constraint error classification', () => {
    it('a CHECK constraint violation (addStaff base_paise <= 0) is a RuleViolationError with a human message, not the raw SQLite text verbatim', async () => {
      const { engine } = await setup()
      let caught: unknown
      try {
        engine.addStaff(ADMIN, {
          name: 'Bad Staff',
          type: 'ADMIN',
          department: 'Admin',
          base_paise: -100, // schema: CHECK (base_paise > 0)
          years_service: 0,
          specialty: null,
          icu_assigned: 0,
          night_shifts: 0,
          on_call: 0,
          joined_at: ANCHOR_ISO,
        })
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(RuleViolationError)
      const message = (caught as Error).message
      // Human, not the raw SQLite sentence verbatim as the whole message...
      expect(message).not.toBe('CHECK constraint failed: base_paise > 0')
      expect(message.startsWith('CHECK constraint failed')).toBe(false)
      expect(message).toMatch(/data rule/i)
      // ...but still names which rule was violated.
      expect(message).toMatch(/base_paise/i)
    })

    it('a FOREIGN KEY constraint violation (bogus patientId) is NOT wrapped as a RuleViolationError', async () => {
      const { engine } = await setup()
      let caught: unknown
      try {
        engine.admit(ADMIN, {
          patientId: 999_999,
          bedId: 2, // bed 2 is unoccupied — isolates the FK failure from the bed-occupied UNIQUE case
          diagnosis: 'x',
          depositPaise: rupees(1000),
        })
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(Error)
      expect(caught).not.toBeInstanceOf(RuleViolationError)
      expect((caught as Error).message).toMatch(/FOREIGN KEY/i)
    })
  })
})
