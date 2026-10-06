import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { Db } from '../src/db/database'
import { FixedClock, ANCHOR_ISO } from '../src/core/clock'
import { Engine } from '../src/core/engine'
import { can, MATRIX } from '../src/core/permissions'
import type { Permission, Role } from '../src/core/permissions'
import { rupees } from '../src/core/money'
import type { EventRow } from '../src/core/events'
import {
  describeEvent,
  displayName,
  eventNamesFrom,
  historyFrames,
  historyInstant,
  historyTimeline,
  samplePatient,
  timeMachineVm,
} from '../src/app/viewmodels'
import type { EventNames } from '../src/app/viewmodels'
import { planLayout, WARD_ORDER } from '../src/app/plan/layout'
import type { PlanBedInput, Variant } from '../src/app/plan/layout'
import { ROUTES, routeFromHash, routeFromKey } from '../src/app/routes'
import { bedRule, replayCheck, tryDischargeAsNurse, tryDoubleBooking } from '../src/app/demos'
import { rolesWith, whoMay } from '../src/app/session'
import { parseRupees } from '../src/app/screens/BedPanel'

/**
 * The logic behind the Hospital view and its live demonstrations: event
 * sentences, the time machine's frames, the floor plan's geometry, routing,
 * and the three "try to break it" demos run against the real seeded
 * database (the same public/demo.db the page boots from).
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

async function seededEngine(): Promise<Engine> {
  const db = await Db.restore(new Uint8Array(readFileSync(join(repoRoot, 'public', 'demo.db'))))
  return new Engine(db, new FixedClock(ANCHOR_ISO))
}

function event(action: EventRow['action'], payload: unknown, actorUserId: number | null = 2): EventRow {
  return { id: 1, at: ANCHOR_ISO, actorUserId, action, entity: 'x', entityId: 1, payload: JSON.stringify(payload) }
}

const NAMES: EventNames = {
  user: (id) => (id === 2 ? { username: 'reception', role: 'RECEPTION' } : id === 3 ? { username: 'dr.rao', role: 'DOCTOR' } : undefined),
  patient: (id) => (id === 7 ? 'Asha Rao' : undefined),
  admission: (id) => (id === 40 ? 'Asha Rao' : undefined),
  bed: (id) => (id === 8 ? 'G-08' : id === 23 ? 'P-01' : undefined),
  ambulance: (id) => (id === 1 ? 'WD-AMB-01' : undefined),
  dispatchAmbulance: (id) => (id === 62 ? 1 : undefined),
}

const sentence = (e: EventRow) => {
  const s = describeEvent(e, NAMES)
  return `${s.who} ${s.did}`
}

describe('describeEvent: the event log in plain English', () => {
  it('names the actor the way a person would', () => {
    expect(displayName('dr.rao')).toBe('Dr Rao')
    expect(displayName('nurse.k')).toBe('Nurse K')
    expect(displayName('admin')).toBe('Admin')
    expect(displayName('reception')).toBe('Reception')
  })

  it('writes one sentence per action, with names instead of ids', () => {
    expect(sentence(event('ADMITTED', { patientId: 7, bedId: 8, diagnosis: 'Fever', depositPaise: 0, admissionId: 40 }))).toBe(
      'Reception admitted Asha Rao to bed G-08.',
    )
    expect(sentence(event('TRANSFERRED', { admissionId: 40, toBedId: 23 }))).toBe('Reception moved Asha Rao to bed P-01.')
    expect(
      sentence(event('CHARGE_ADDED', { admissionId: 40, kind: 'PHARMACY', description: 'Paracetamol', amountPaise: 25000, chargeId: 1 }, 3)),
    ).toBe('Dr Rao added a pharmacy charge of ₹250.00 for Asha Rao (Paracetamol).')
    expect(sentence(event('DEPOSIT_RECORDED', { admissionId: 40, amountPaise: 300000 }))).toBe(
      'Reception took a deposit of ₹3,000.00 from Asha Rao.',
    )
    expect(sentence(event('AMBULANCE_DISPATCHED', { ambulanceId: 1, location: 'Andheri West', dispatchId: 62 }))).toBe(
      'Reception sent ambulance WD-AMB-01 to Andheri West.',
    )
    expect(sentence(event('AMBULANCE_RETURNED', { dispatchId: 62 }))).toBe('Reception marked ambulance WD-AMB-01 back on station.')
    expect(sentence(event('PATIENT_REGISTERED', { name: 'Asha Rao', mrn: 'WH-0007', patientId: 7 }))).toBe(
      'Reception registered Asha Rao as WH-0007.',
    )
  })

  it('says which way the money goes on a discharge', () => {
    const owes = event('DISCHARGED', { admissionId: 40, invoice: { balancePaise: 12345 } })
    const refund = event('DISCHARGED', { admissionId: 40, invoice: { balancePaise: -500 } })
    const settled = event('DISCHARGED', { admissionId: 40, invoice: { balancePaise: 0 } })
    expect(sentence(owes)).toBe('Reception discharged Asha Rao. They owe ₹123.45.')
    expect(sentence(refund)).toBe('Reception discharged Asha Rao. They get ₹5.00 back.')
    expect(sentence(settled)).toBe('Reception discharged Asha Rao. Nothing is owed either way.')
  })

  it('still reads sensibly when an id is unknown or the payload is damaged', () => {
    expect(sentence(event('ADMITTED', { patientId: 99, bedId: 98 }))).toBe('Reception admitted patient #99 to bed #98.')
    expect(sentence(event('ADMITTED', { patientId: 7, bedId: 8 }, null))).toBe('The system admitted Asha Rao to bed G-08.')
    expect(sentence(event('USER_CREATED', { username: 'billing', role: 'BILLING' }, 0))).toBe('The system created the login billing.')
    expect(sentence(event('ADMITTED', { patientId: 7, bedId: 8 }, 41))).toBe('User #41 admitted Asha Rao to bed G-08.')
    expect(sentence({ ...event('ADMITTED', {}), payload: '{not json' })).toBe('Reception admitted a patient to a bed.')
  })

  it('names every event in the seeded six months without falling back to an id', async () => {
    const engine = await seededEngine()
    const events = engine.eventsLog()
    const names = eventNamesFrom(engine, events)
    for (const e of events) {
      const s = describeEvent(e, names)
      expect(`${s.who} ${s.did}`, `event #${e.id} ${e.action}`).not.toMatch(/#\d|a patient\b/)
    }
  }, 30_000)
})

describe('historyFrames: the time machine', () => {
  it('spans from the first event to the anchor, one position per morning', async () => {
    const engine = await seededEngine()
    const events = engine.eventsLog()
    const timeline = historyTimeline(events, ANCHOR_ISO)
    expect(timeline.startIso).toBe('2026-02-01T03:30:00.000Z')
    expect(timeline.days).toBe(181)
    expect(historyInstant(timeline, ANCHOR_ISO, 0)).toBe(timeline.startIso)
    expect(historyInstant(timeline, ANCHOR_ISO, timeline.days)).toBe(ANCHOR_ISO)
    expect(historyInstant(timeline, ANCHOR_ISO, 1)).toBe('2026-02-02T03:30:00.000Z')
  }, 30_000)

  it('ends on a frame identical to the live ward, names included', async () => {
    const engine = await seededEngine()
    const beds = engine.beds().map((b) => ({ id: b.id, label: b.label, ward: b.ward, ratePaise: b.ratePaise }))
    const frames = historyFrames(engine.eventsLog(), beds, ANCHOR_ISO)
    expect(frames).toHaveLength(182)
    const today = frames[frames.length - 1]
    expect(today.occupied).toBe(engine.census().active)
    for (const live of engine.beds()) {
      const replayed = today.beds.find((b) => b.id === live.id)!
      expect(replayed.occupied, live.label).toBe(live.occupied)
      expect(replayed.patientName, live.label).toBe(live.patientName)
    }
    const out = engine.ambulances().filter((a) => a.openDispatch)
    expect(today.ambulancesOut.map((o) => o.ambulanceId)).toEqual(out.map((a) => a.id))
    expect(today.ambulancesOut.map((o) => o.location)).toEqual(out.map((a) => a.openDispatch!.location))
  }, 30_000)

  it('shows an empty hospital before the first admission', async () => {
    const engine = await seededEngine()
    const beds = engine.beds().map((b) => ({ id: b.id, label: b.label, ward: b.ward, ratePaise: b.ratePaise }))
    const first = timeMachineVm(engine.eventsLog(), beds, '2026-02-01T03:30:00.000Z')
    expect(first.activeAdmissions).toBe(0)
    expect(first.beds.every((b) => !b.occupied && b.patientName === undefined)).toBe(true)
  }, 30_000)
})

describe('samplePatient', () => {
  it('is deterministic, valid for the admit form, and different from one number to the next', () => {
    expect(samplePatient(61)).toEqual(samplePatient(61))
    expect(samplePatient(61).name).not.toBe(samplePatient(62).name)
    for (let n = 0; n < 200; n++) {
      const p = samplePatient(n)
      expect(p.idLast4).toMatch(/^\d{4}$/)
      expect(p.dobIso).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Number.isNaN(Date.parse(p.dobIso))).toBe(false)
      expect(p.phone).toMatch(/^98\d{8}$/)
      expect(['F', 'M']).toContain(p.gender)
      expect(p.name.split(' ')).toHaveLength(2)
      expect(p.diagnosis.length).toBeGreaterThan(0)
    }
  })
})

describe('planLayout: the floor plan geometry', () => {
  const LAYOUT: { ward: string; count: number; prefix: string }[] = [
    { ward: 'GENERAL', count: 14, prefix: 'G' },
    { ward: 'TWIN', count: 8, prefix: 'T' },
    { ward: 'PRIVATE', count: 6, prefix: 'P' },
    { ward: 'ICU', count: 4, prefix: 'I' },
  ]
  // ids deliberately out of label order, to show placement follows the label
  const beds: PlanBedInput[] = LAYOUT.flatMap((w) =>
    Array.from({ length: w.count }, (_, i) => ({ id: 1000 - (w.prefix.charCodeAt(0) * 20 + i), label: `${w.prefix}-${String(i + 1).padStart(2, '0')}`, ward: w.ward })),
  )

  it.each<Variant>(['wide', 'tall'])('%s: places every bed exactly once, inside the drawing and inside its ward', (variant) => {
    const layout = planLayout(beds, variant)
    expect(layout.beds.map((b) => b.id).sort()).toEqual(beds.map((b) => b.id).sort())
    for (const box of layout.beds) {
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.w).toBeLessThanOrEqual(layout.width)
      expect(box.y + box.h).toBeLessThanOrEqual(layout.height)
      const zone = layout.zones.find((z) => z.ward === box.ward)!
      expect(box.x >= zone.x && box.x + box.w <= zone.x + zone.w, `${box.label} inside ${zone.ward} horizontally`).toBe(true)
      expect(box.y >= zone.y && box.y + box.h <= zone.y + zone.h, `${box.label} inside ${zone.ward} vertically`).toBe(true)
    }
  })

  it.each<Variant>(['wide', 'tall'])('%s: no two beds overlap', (variant) => {
    const boxes = planLayout(beds, variant).beds
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
        expect(apart, `${a.label} and ${b.label}`).toBe(true)
      }
    }
  })

  it('wide: puts beds in label order and draws one floor line per ward', () => {
    const layout = planLayout(beds, 'wide')
    const general = layout.beds.filter((b) => b.ward === 'GENERAL')
    expect(general[0].label).toBe('G-01')
    expect(general[0].x).toBeLessThan(general[1].x)
    expect(layout.lines.map((l) => l.ward).sort()).toEqual([...WARD_ORDER].sort())
    expect(layout.ambulanceSlots).toHaveLength(4)
  })

  it('ignores a bed in a ward it does not know', () => {
    const layout = planLayout([...beds, { id: 5000, label: 'X-01', ward: 'ANNEXE' }], 'wide')
    expect(layout.beds.some((b) => b.id === 5000)).toBe(false)
  })
})

describe('routes', () => {
  it('maps every current and earlier view name to a view', () => {
    expect(routeFromKey('bills')).toBe('bills')
    expect(routeFromKey('#billing')).toBe('bills')
    expect(routeFromKey('time-machine')).toBe('hospital')
    expect(routeFromKey('Deck')).toBe('hospital')
    expect(routeFromKey('payroll')).toBe('staff')
    expect(routeFromKey('audit')).toBe('event-log')
    expect(routeFromKey('about')).toBe('measurements')
    expect(routeFromKey('how-it-works')).toBe('hospital')
    expect(routeFromKey('nowhere')).toBeNull()
    expect(routeFromHash('')).toBe('hospital')
    expect(routeFromHash('#nowhere')).toBe('hospital')
  })

  it('opens each view to exactly the roles the permission table allows', () => {
    const roles: Role[] = ['ADMIN', 'RECEPTION', 'DOCTOR', 'NURSE', 'BILLING']
    const def = (key: string) => ROUTES.find((r) => r.key === key)!
    for (const role of roles) {
      expect(def('bills').allowed(role), role).toBe(can(role, 'VIEW_BILLING'))
      expect(def('ambulances').allowed(role), role).toBe(can(role, 'VIEW_CLINICAL'))
      expect(def('staff').allowed(role), role).toBe(role === 'ADMIN')
      expect(def('event-log').allowed(role), role).toBe(role === 'ADMIN')
      expect(def('hospital').allowed(role)).toBe(true)
    }
  })
})

describe('who may do what, in words', () => {
  it('lists exactly the roles the permission table grants, administrator last', () => {
    // the administrator holds every permission, so its row lists them all
    const permissions: Permission[] = [...MATRIX.ADMIN]
    for (const permission of permissions) {
      const roles = rolesWith(permission)
      for (const role of Object.keys(MATRIX) as Role[]) expect(roles.includes(role), `${role} ${permission}`).toBe(can(role, permission))
    }
    expect(whoMay('DISCHARGE')).toBe('reception or the administrator')
    expect(whoMay('ADD_CHARGE')).toBe('doctor, billing desk or the administrator')
  })
})

describe('the live demonstrations, against the seeded database', () => {
  it('a nurse is refused a discharge by the engine, and nothing changes', async () => {
    const engine = await seededEngine()
    const before = engine.eventsLog().length
    const active = engine.admissionsActive().length
    const result = tryDischargeAsNurse(engine)
    expect(result?.message).toBe('NURSE is not permitted to DISCHARGE')
    expect(engine.eventsLog().length).toBe(before)
    expect(engine.admissionsActive().length).toBe(active)
  }, 30_000)

  it('a second patient in an occupied bed is refused by SQLite itself, and nothing changes', async () => {
    const engine = await seededEngine()
    const admissions = engine.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM admissions')!.n
    const result = tryDoubleBooking(engine)
    expect(result?.message).toMatch(/UNIQUE constraint failed: admissions\.bed_id/)
    expect(engine.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM admissions')!.n).toBe(admissions)
    expect(bedRule(engine)).toMatch(/CREATE UNIQUE INDEX uq_active_bed ON admissions\(bed_id\) WHERE status = 'ACTIVE'/)
  }, 30_000)

  it('the replay check reproduces the seeded hospital identically', async () => {
    const engine = await seededEngine()
    let t = 0
    const result = replayCheck(engine, () => (t += 5))
    expect(result.identical).toBe(true)
    expect(result.differences).toEqual([])
    expect(result.events).toBe(engine.eventsLog().length)
    expect(result.patients).toBe(engine.census().patients)
    expect(result.milliseconds).toBe(5)
  }, 30_000)

  it('both refusals report nothing to try on an empty ward', async () => {
    const db = await Db.fresh()
    const engine = new Engine(db, new FixedClock(ANCHOR_ISO))
    db.run(`INSERT INTO beds (id,label,ward,rate_paise) VALUES (1,'G-01','GENERAL',150000)`)
    expect(tryDoubleBooking(engine)).toBeUndefined()
    expect(tryDischargeAsNurse(engine)).toBeUndefined()
  })
})

describe('parseRupees: amounts typed into the forms', () => {
  it('turns rupees into whole paise and explains anything else', () => {
    expect(parseRupees('1,500', { allowZero: false })).toEqual({ paise: rupees(1500) })
    expect(parseRupees(' 12.5 ', { allowZero: false })).toEqual({ paise: 1250 })
    expect(parseRupees('0', { allowZero: true })).toEqual({ paise: 0 })
    expect(parseRupees('0', { allowZero: false })).toEqual({ error: 'Enter more than zero rupees.' })
    expect(parseRupees('-5', { allowZero: true })).toEqual({ error: 'Enter zero or more rupees.' })
    expect(parseRupees('1.234', { allowZero: false })).toEqual({ error: 'Use at most two decimal places (paise).' })
    expect(parseRupees('', { allowZero: true })).toEqual({ error: 'Enter an amount in rupees.' })
    expect(parseRupees('abc', { allowZero: true })).toEqual({ error: 'Enter zero or more rupees.' })
  })
})
