import { describe, it, expect } from 'vitest'
import { Db } from '../src/db/database'
import { FixedClock, ANCHOR_ISO } from '../src/core/clock'
import { Engine, type Actor, type BedView } from '../src/core/engine'
import { computeInvoice } from '../src/core/billing'
import { rupees } from '../src/core/money'
import { formatINR, formatDateIST, formatDateTimeIST } from '../src/app/format'
import { bedGrid, chartVm, WARD_ORDER } from '../src/app/viewmodels'

const ADMIN: Actor = { userId: 1, role: 'ADMIN', username: 'admin' }
const DOCTOR: Actor = { userId: 2, role: 'DOCTOR', username: 'dr.rao' }
const RECEPTION: Actor = { userId: 3, role: 'RECEPTION', username: 'reception' }

// Mirrors src/seed/facility.ts's WARD_LAYOUT (14 GENERAL / 8 TWIN / 6 PRIVATE
// / 4 ICU = 32 beds) without touching the real (slow) seed — hand-built
// BedView fixtures per the brief's guidance.
const WARD_LAYOUT: { ward: (typeof WARD_ORDER)[number]; count: number; ratePaise: number; prefix: string }[] = [
  { ward: 'GENERAL', count: 14, ratePaise: 150000, prefix: 'G' },
  { ward: 'TWIN', count: 8, ratePaise: 280000, prefix: 'T' },
  { ward: 'PRIVATE', count: 6, ratePaise: 500000, prefix: 'P' },
  { ward: 'ICU', count: 4, ratePaise: 950000, prefix: 'I' },
]

function buildFixtureBeds(occupiedIds: Set<number> = new Set()): BedView[] {
  const beds: BedView[] = []
  let id = 1
  for (const w of WARD_LAYOUT) {
    for (let i = 1; i <= w.count; i++) {
      const occupied = occupiedIds.has(id)
      beds.push({
        id,
        label: `${w.prefix}${i}`,
        ward: w.ward,
        ratePaise: w.ratePaise,
        occupied,
        patientName: occupied ? `Patient ${id}` : undefined,
        admissionId: occupied ? id : undefined,
        admittedAt: occupied ? ANCHOR_ISO : undefined,
      })
      id++
    }
  }
  return beds
}

describe('bedGrid', () => {
  it('groups all 32 fixture beds into GENERAL/TWIN/PRIVATE/ICU, in that fixed order', () => {
    const beds = buildFixtureBeds()
    const groups = bedGrid(beds)
    expect(groups.map((g) => g.ward)).toEqual(['GENERAL', 'TWIN', 'PRIVATE', 'ICU'])
    expect(groups.reduce((n, g) => n + g.beds.length, 0)).toBe(32)
  })

  it('assigns each ward its correct bed count', () => {
    const beds = buildFixtureBeds()
    const groups = bedGrid(beds)
    const counts = Object.fromEntries(groups.map((g) => [g.ward, g.beds.length]))
    expect(counts).toEqual({ GENERAL: 14, TWIN: 8, PRIVATE: 6, ICU: 4 })
  })

  it('computes accurate per-ward free/occupied counts', () => {
    // Occupy bed 1 (GENERAL) and beds 15-16 (TWIN, first two).
    const beds = buildFixtureBeds(new Set([1, 15, 16]))
    const groups = bedGrid(beds)

    const general = groups.find((g) => g.ward === 'GENERAL')!
    expect(general.occupiedCount).toBe(1)
    expect(general.freeCount).toBe(13)

    const twin = groups.find((g) => g.ward === 'TWIN')!
    expect(twin.occupiedCount).toBe(2)
    expect(twin.freeCount).toBe(6)

    const priv = groups.find((g) => g.ward === 'PRIVATE')!
    expect(priv.occupiedCount).toBe(0)
    expect(priv.freeCount).toBe(6)

    const icu = groups.find((g) => g.ward === 'ICU')!
    expect(icu.occupiedCount).toBe(0)
    expect(icu.freeCount).toBe(4)
  })

  it('is stable on an empty bed list (still returns all four ward groups)', () => {
    const groups = bedGrid([])
    expect(groups.map((g) => g.ward)).toEqual(['GENERAL', 'TWIN', 'PRIVATE', 'ICU'])
    for (const g of groups) {
      expect(g.beds).toEqual([])
      expect(g.freeCount).toBe(0)
      expect(g.occupiedCount).toBe(0)
    }
  })
})

/** Fresh db + engine wired to a FixedClock, with two GENERAL beds seeded — cheap, no full seed. */
async function setupEngine() {
  const db = await Db.fresh()
  const clock = new FixedClock(ANCHOR_ISO)
  const engine = new Engine(db, clock)
  db.run(`INSERT INTO beds (id,label,ward,rate_paise) VALUES (1,'G1','GENERAL',150000)`)
  db.run(`INSERT INTO beds (id,label,ward,rate_paise) VALUES (2,'G2','GENERAL',150000)`)
  return { db, engine }
}

function registerAndAdmit(
  engine: Engine,
  depositPaiseAmount: number,
  bedId = 1,
): number {
  const patientId = engine.registerPatient(ADMIN, {
    name: 'Asha Rao',
    gender: 'F',
    dobIso: '1990-01-01',
    phone: '9990000001',
    idLast4: '1234',
  })
  return engine.admit(ADMIN, {
    patientId,
    bedId,
    diagnosis: 'Fever',
    depositPaise: depositPaiseAmount,
  })
}

describe('chartVm', () => {
  it('filters permitted actions per role: doctor can add-charge but not discharge; reception is the reverse', async () => {
    const { engine } = await setupEngine()
    const admissionId = registerAndAdmit(engine, rupees(5000))

    const doctorVm = chartVm(engine, DOCTOR, admissionId)
    expect(doctorVm.permittedActions.addCharge).toBe(true)
    expect(doctorVm.permittedActions.discharge).toBe(false)
    expect(doctorVm.permittedActions.transfer).toBe(false)

    const receptionVm = chartVm(engine, RECEPTION, admissionId)
    expect(receptionVm.permittedActions.addCharge).toBe(false)
    expect(receptionVm.permittedActions.discharge).toBe(true)
    expect(receptionVm.permittedActions.transfer).toBe(true)
  })

  it('preview matches computeInvoice for the fixture', async () => {
    const { engine } = await setupEngine()
    const depositPaise = rupees(5000)
    const admissionId = registerAndAdmit(engine, depositPaise)
    engine.addCharge(ADMIN, {
      admissionId,
      kind: 'PHARMACY',
      description: 'Paracetamol',
      amountPaise: rupees(200),
    })

    const vm = chartVm(engine, ADMIN, admissionId)
    const expected = computeInvoice({
      admittedAtIso: ANCHOR_ISO,
      dischargedAtIso: ANCHOR_ISO, // FixedClock never advances in this fixture
      roomRatePaise: 150000,
      lines: [{ kind: 'PHARMACY', description: 'Paracetamol', amountPaise: rupees(200) }],
      depositPaise,
    })
    expect(vm.isDischarged).toBe(false)
    expect(vm.preview).toEqual(expected)
    expect(vm.charges).toEqual(expected.lines)
  })

  it('labels the refund case once discharged, when deposit exceeds the final balance', async () => {
    const { engine } = await setupEngine()
    const admissionId = registerAndAdmit(engine, rupees(100000))
    engine.discharge(ADMIN, { admissionId })

    const vm = chartVm(engine, ADMIN, admissionId)
    expect(vm.found).toBe(true)
    expect(vm.isDischarged).toBe(true)
    expect(vm.invoice?.isRefund).toBe(true)
    expect(vm.invoice?.refundPaise).toBeGreaterThan(0)
    expect(vm.invoice?.balancePaise).toBeLessThan(0)
  })

  it('does not label a non-refund discharge as a refund', async () => {
    const { engine } = await setupEngine()
    const admissionId = registerAndAdmit(engine, rupees(100))
    engine.discharge(ADMIN, { admissionId })

    const vm = chartVm(engine, ADMIN, admissionId)
    expect(vm.isDischarged).toBe(true)
    expect(vm.invoice?.isRefund).toBe(false)
    expect(vm.invoice?.refundPaise).toBe(0)
  })

  it('reports found=false for an unknown admission id', async () => {
    const { engine } = await setupEngine()
    const vm = chartVm(engine, ADMIN, 999)
    expect(vm.found).toBe(false)
  })
})

describe('format', () => {
  it('formatINR re-exports core/money formatting', () => {
    expect(formatINR(150000)).toBe('₹1,500.00')
  })

  it('formatDateIST renders an IST calendar date', () => {
    // ANCHOR_ISO = 2026-08-01T03:30:00.000Z; +5:30 = 2026-08-01T09:00 IST
    expect(formatDateIST(ANCHOR_ISO)).toBe('01 Aug 2026')
  })

  it('formatDateIST rolls the calendar date forward across the IST offset', () => {
    // 2026-08-01T20:00:00Z + 5:30 = 2026-08-02T01:30 IST
    expect(formatDateIST('2026-08-01T20:00:00.000Z')).toBe('02 Aug 2026')
  })

  it('formatDateTimeIST includes the IST time and zone label', () => {
    expect(formatDateTimeIST(ANCHOR_ISO)).toBe('01 Aug 2026, 09:00 IST')
  })
})
