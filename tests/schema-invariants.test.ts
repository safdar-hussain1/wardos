import { describe, it, expect } from 'vitest'
import { Db } from '../src/db/database'

/** One bed (id=1), two patients (id=1,2). Raw INSERTs, no service layer. */
function seedMinimal(db: Db): void {
  db.run(
    `INSERT INTO beds (id,label,ward,rate_paise) VALUES (1,'B1','GENERAL',100000)`,
  )
  db.run(
    `INSERT INTO patients (id,mrn,name,gender,dob,phone,id_last4,created_at) VALUES
     (1,'MRN1','Patient One','F','1990-01-01','9990000001','1234','2026-08-01T00:00:00.000Z')`,
  )
  db.run(
    `INSERT INTO patients (id,mrn,name,gender,dob,phone,id_last4,created_at) VALUES
     (2,'MRN2','Patient Two','M','1985-05-05','9990000002','5678','2026-08-01T00:00:00.000Z')`,
  )
}

describe('schema invariants', () => {
  it('C1: second ACTIVE admission on the same bed is impossible', async () => {
    const db = await Db.fresh()
    seedMinimal(db)
    db.run(
      `INSERT INTO admissions (patient_id,bed_id,diagnosis,status,admitted_at) VALUES (1,1,'x','ACTIVE','2026-08-01T00:00:00.000Z')`,
    )
    expect(() =>
      db.run(
        `INSERT INTO admissions (patient_id,bed_id,diagnosis,status,admitted_at) VALUES (2,1,'y','ACTIVE','2026-08-01T01:00:00.000Z')`,
      ),
    ).toThrow(/UNIQUE|constraint/i)
    db.close()
  })

  it('one active admission per patient is impossible', async () => {
    const db = await Db.fresh()
    seedMinimal(db)
    db.run(
      `INSERT INTO beds (id,label,ward,rate_paise) VALUES (2,'B2','GENERAL',100000)`,
    )
    db.run(
      `INSERT INTO admissions (patient_id,bed_id,diagnosis,status,admitted_at) VALUES (1,1,'x','ACTIVE','2026-08-01T00:00:00.000Z')`,
    )
    expect(() =>
      db.run(
        `INSERT INTO admissions (patient_id,bed_id,diagnosis,status,admitted_at) VALUES (1,2,'y','ACTIVE','2026-08-01T01:00:00.000Z')`,
      ),
    ).toThrow(/UNIQUE|constraint/i)
    db.close()
  })

  it('XOR check: DISCHARGED status requires discharged_at', async () => {
    const db = await Db.fresh()
    seedMinimal(db)
    expect(() =>
      db.run(
        `INSERT INTO admissions (patient_id,bed_id,diagnosis,status,admitted_at,discharged_at) VALUES (1,1,'x','DISCHARGED','2026-08-01T00:00:00.000Z',NULL)`,
      ),
    ).toThrow(/CHECK|constraint/i)
    db.close()
  })

  it('events table rejects UPDATE', async () => {
    const db = await Db.fresh()
    db.run(
      `INSERT INTO events (at,actor_user_id,action,entity,entity_id,payload) VALUES ('2026-08-01T00:00:00.000Z',NULL,'CREATE','patient',1,'{}')`,
    )
    expect(() => db.run(`UPDATE events SET action = 'CHANGED' WHERE id = 1`)).toThrow(
      /events is append-only/,
    )
    db.close()
  })

  it('events table rejects DELETE', async () => {
    const db = await Db.fresh()
    db.run(
      `INSERT INTO events (at,actor_user_id,action,entity,entity_id,payload) VALUES ('2026-08-01T00:00:00.000Z',NULL,'CREATE','patient',1,'{}')`,
    )
    expect(() => db.run(`DELETE FROM events WHERE id = 1`)).toThrow(/events is append-only/)
    db.close()
  })

  it('negative amount_paise on charges is rejected', async () => {
    const db = await Db.fresh()
    seedMinimal(db)
    db.run(
      `INSERT INTO admissions (patient_id,bed_id,diagnosis,status,admitted_at) VALUES (1,1,'x','ACTIVE','2026-08-01T00:00:00.000Z')`,
    )
    expect(() =>
      db.run(
        `INSERT INTO charges (admission_id,kind,description,amount_paise,charged_at) VALUES (1,'PHARMACY','aspirin',-100,'2026-08-01T00:00:00.000Z')`,
      ),
    ).toThrow(/CHECK|constraint/i)
    db.close()
  })

  it('inTransaction rolls back both writes when the second fails', async () => {
    const db = await Db.fresh()
    seedMinimal(db)
    expect(() =>
      db.inTransaction(() => {
        db.run(
          `INSERT INTO admissions (patient_id,bed_id,diagnosis,status,admitted_at) VALUES (1,1,'x','ACTIVE','2026-08-01T00:00:00.000Z')`,
        )
        db.run(
          `INSERT INTO charges (admission_id,kind,description,amount_paise,charged_at) VALUES (1,'PHARMACY','aspirin',-100,'2026-08-01T00:00:00.000Z')`,
        )
      }),
    ).toThrow()
    const admissions = db.all(`SELECT * FROM admissions`)
    const charges = db.all(`SELECT * FROM charges`)
    expect(admissions).toHaveLength(0)
    expect(charges).toHaveLength(0)
    db.close()
  })

  it('recovers after a rollback: a later inTransaction still commits', async () => {
    const db = await Db.fresh()
    seedMinimal(db)
    expect(() =>
      db.inTransaction(() => {
        db.run(
          `INSERT INTO admissions (patient_id,bed_id,diagnosis,status,admitted_at) VALUES (1,1,'x','ACTIVE','2026-08-01T00:00:00.000Z')`,
        )
        throw new Error('boom')
      }),
    ).toThrow('boom')

    db.inTransaction(() => {
      db.run(
        `INSERT INTO admissions (patient_id,bed_id,diagnosis,status,admitted_at) VALUES (1,1,'x','ACTIVE','2026-08-01T00:00:00.000Z')`,
      )
    })

    const admissions = db.all(`SELECT * FROM admissions`)
    expect(admissions).toHaveLength(1)
    db.close()
  })

  it('serialize/restore round-trips data', async () => {
    const db = await Db.fresh()
    seedMinimal(db)
    const bytes = db.serialize()
    db.close()

    const restored = await Db.restore(bytes)
    const patients = restored.all<{ id: number; mrn: string }>(`SELECT * FROM patients`)
    expect(patients).toHaveLength(2)
    expect(patients.map((p) => p.mrn).sort()).toEqual(['MRN1', 'MRN2'])
    restored.close()
  })

  it('foreign_keys are enforced after restore', async () => {
    const db = await Db.fresh()
    seedMinimal(db)
    const bytes = db.serialize()
    db.close()

    const restored = await Db.restore(bytes)
    expect(() =>
      restored.run(
        `INSERT INTO charges (admission_id,kind,description,amount_paise,charged_at) VALUES (999,'PHARMACY','aspirin',100,'2026-08-01T00:00:00.000Z')`,
      ),
    ).toThrow(/FOREIGN KEY|constraint/i)
    restored.close()
  })

  it('lastId returns the id of the last inserted row', async () => {
    const db = await Db.fresh()
    seedMinimal(db)
    db.run(
      `INSERT INTO admissions (patient_id,bed_id,diagnosis,status,admitted_at) VALUES (1,1,'x','ACTIVE','2026-08-01T00:00:00.000Z')`,
    )
    expect(db.lastId()).toBe(1)
    db.close()
  })

  it('get returns a single row or undefined', async () => {
    const db = await Db.fresh()
    seedMinimal(db)
    const found = db.get<{ mrn: string }>(`SELECT mrn FROM patients WHERE id = ?`, [1])
    expect(found?.mrn).toBe('MRN1')
    const missing = db.get(`SELECT mrn FROM patients WHERE id = ?`, [999])
    expect(missing).toBeUndefined()
    db.close()
  })

  it('inTransaction throws when called while already inside a transaction', async () => {
    const db = await Db.fresh()
    expect(() =>
      db.inTransaction(() => {
        db.inTransaction(() => {
          // nested — should throw before this ever runs
        })
      }),
    ).toThrow()
    db.close()
  })
})
