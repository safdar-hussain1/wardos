import { describe, it, expect } from 'vitest'
import { Db } from '../src/db/database'
import { FixedClock, ANCHOR_ISO } from '../src/core/clock'
import { Engine, type Actor } from '../src/core/engine'
import { AccessDeniedError, RuleViolationError } from '../src/core/errors'
import { can, type Role, type Permission } from '../src/core/permissions'
import { rupees } from '../src/core/money'

/**
 * One case per Engine command that is permission-checked (queries need no
 * permission per the brief, so VIEW_CLINICAL/VIEW_BILLING have no case here).
 * `seed` inserts the minimal fixture rows (via raw SQL, bypassing the engine)
 * that let the command succeed when the actor's role *is* permitted.
 */
interface Case {
  permission: Permission
  name: string
  seed: (db: Db) => void
  run: (e: Engine, a: Actor) => void
}

const CASES: Case[] = [
  {
    permission: 'REGISTER_PATIENT',
    name: 'registerPatient',
    seed: () => {},
    run: (e, a) =>
      void e.registerPatient(a, {
        name: 'T',
        gender: 'F',
        dobIso: '1990-01-01',
        phone: '9',
        idLast4: '1234',
      }),
  },
  {
    permission: 'ADMIT',
    name: 'admit',
    seed: (db) => {
      db.run(`INSERT INTO beds (id,label,ward,rate_paise) VALUES (1,'B1','GENERAL',100000)`)
      db.run(
        `INSERT INTO patients (id,mrn,name,gender,dob,phone,id_last4,created_at) VALUES (1,'WH-0001','P1','F','1990-01-01','9','1234','${ANCHOR_ISO}')`,
      )
    },
    run: (e, a) =>
      void e.admit(a, { patientId: 1, bedId: 1, diagnosis: 'x', depositPaise: rupees(1000) }),
  },
  {
    permission: 'TRANSFER',
    name: 'transfer',
    seed: (db) => {
      db.run(`INSERT INTO beds (id,label,ward,rate_paise) VALUES (1,'B1','GENERAL',100000)`)
      db.run(`INSERT INTO beds (id,label,ward,rate_paise) VALUES (2,'B2','GENERAL',100000)`)
      db.run(
        `INSERT INTO patients (id,mrn,name,gender,dob,phone,id_last4,created_at) VALUES (1,'WH-0001','P1','F','1990-01-01','9','1234','${ANCHOR_ISO}')`,
      )
      db.run(
        `INSERT INTO admissions (id,patient_id,bed_id,diagnosis,deposit_paise,status,admitted_at) VALUES (1,1,1,'x',0,'ACTIVE','${ANCHOR_ISO}')`,
      )
    },
    run: (e, a) => void e.transfer(a, { admissionId: 1, toBedId: 2 }),
  },
  {
    permission: 'DISCHARGE',
    name: 'discharge',
    seed: (db) => {
      db.run(`INSERT INTO beds (id,label,ward,rate_paise) VALUES (1,'B1','GENERAL',100000)`)
      db.run(
        `INSERT INTO patients (id,mrn,name,gender,dob,phone,id_last4,created_at) VALUES (1,'WH-0001','P1','F','1990-01-01','9','1234','${ANCHOR_ISO}')`,
      )
      db.run(
        `INSERT INTO admissions (id,patient_id,bed_id,diagnosis,deposit_paise,status,admitted_at) VALUES (1,1,1,'x',0,'ACTIVE','${ANCHOR_ISO}')`,
      )
    },
    run: (e, a) => void e.discharge(a, { admissionId: 1 }),
  },
  {
    permission: 'ADD_CHARGE',
    name: 'addCharge',
    seed: (db) => {
      db.run(`INSERT INTO beds (id,label,ward,rate_paise) VALUES (1,'B1','GENERAL',100000)`)
      db.run(
        `INSERT INTO patients (id,mrn,name,gender,dob,phone,id_last4,created_at) VALUES (1,'WH-0001','P1','F','1990-01-01','9','1234','${ANCHOR_ISO}')`,
      )
      db.run(
        `INSERT INTO admissions (id,patient_id,bed_id,diagnosis,deposit_paise,status,admitted_at) VALUES (1,1,1,'x',0,'ACTIVE','${ANCHOR_ISO}')`,
      )
    },
    run: (e, a) =>
      void e.addCharge(a, {
        admissionId: 1,
        kind: 'PHARMACY',
        description: 'aspirin',
        amountPaise: rupees(100),
      }),
  },
  {
    permission: 'RECORD_DEPOSIT',
    name: 'recordDeposit',
    seed: (db) => {
      db.run(`INSERT INTO beds (id,label,ward,rate_paise) VALUES (1,'B1','GENERAL',100000)`)
      db.run(
        `INSERT INTO patients (id,mrn,name,gender,dob,phone,id_last4,created_at) VALUES (1,'WH-0001','P1','F','1990-01-01','9','1234','${ANCHOR_ISO}')`,
      )
      db.run(
        `INSERT INTO admissions (id,patient_id,bed_id,diagnosis,deposit_paise,status,admitted_at) VALUES (1,1,1,'x',0,'ACTIVE','${ANCHOR_ISO}')`,
      )
    },
    run: (e, a) => void e.recordDeposit(a, { admissionId: 1, amountPaise: rupees(100) }),
  },
  {
    permission: 'DISPATCH_AMBULANCE',
    name: 'dispatchAmbulance',
    seed: (db) => {
      db.run(`INSERT INTO ambulances (id,plate,model) VALUES (1,'AMB1','Model')`)
    },
    run: (e, a) => void e.dispatchAmbulance(a, { ambulanceId: 1, location: 'x' }),
  },
  {
    permission: 'RETURN_AMBULANCE',
    name: 'returnAmbulance',
    seed: (db) => {
      db.run(`INSERT INTO ambulances (id,plate,model) VALUES (1,'AMB1','Model')`)
      db.run(
        `INSERT INTO dispatches (id,ambulance_id,location,dispatched_at) VALUES (1,1,'x','${ANCHOR_ISO}')`,
      )
    },
    run: (e, a) => void e.returnAmbulance(a, { dispatchId: 1 }),
  },
  {
    permission: 'MANAGE_USERS',
    name: 'addStaff',
    seed: () => {},
    run: (e, a) =>
      void e.addStaff(a, {
        name: 'S',
        type: 'ADMIN',
        department: 'Admin',
        base_paise: rupees(30000),
        years_service: 0,
        specialty: null,
        icu_assigned: 0,
        night_shifts: 0,
        on_call: 0,
        joined_at: ANCHOR_ISO,
      }),
  },
  {
    permission: 'MANAGE_USERS',
    name: 'createUser',
    seed: () => {},
    run: (e, a) => void e.createUser(a, { username: 'newuser1', password: 'pw', role: 'NURSE' }),
  },
]

const ROLES: Role[] = ['ADMIN', 'RECEPTION', 'DOCTOR', 'NURSE', 'BILLING']

describe('Engine permissions — exhaustive C5 matrix', () => {
  for (const role of ROLES) {
    for (const c of CASES) {
      const permitted = can(role, c.permission)
      it(`${role} ${permitted ? 'may' : 'may not'} ${c.name} (${c.permission})`, async () => {
        const db = await Db.fresh()
        const clock = new FixedClock(ANCHOR_ISO)
        const engine = new Engine(db, clock)
        c.seed(db)
        const actor: Actor = { userId: 1, role, username: 'u' }

        if (permitted) {
          // Permitted: either succeeds outright, or fails on a business rule
          // (RuleViolationError) — never on permission.
          try {
            c.run(engine, actor)
          } catch (err) {
            expect(err).toBeInstanceOf(RuleViolationError)
          }
        } else {
          expect(() => c.run(engine, actor)).toThrow(AccessDeniedError)
        }
        db.close()
      })
    }
  }
})
