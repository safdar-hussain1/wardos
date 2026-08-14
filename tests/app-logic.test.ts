import { describe, it, expect } from 'vitest'
import { Db } from '../src/db/database'
import { FixedClock, ANCHOR_ISO } from '../src/core/clock'
import { Engine, type Actor, type BedView } from '../src/core/engine'
import { computeInvoice } from '../src/core/billing'
import { rupees, addP } from '../src/core/money'
import { Doctor, payBreakdown } from '../src/core/staff'
import type { EventRow } from '../src/core/events'
import { formatINR, formatDateIST, formatDateTimeIST } from '../src/app/format'
import {
  bedGrid,
  chartVm,
  WARD_ORDER,
  billingVm,
  payrollVm,
  auditPageVm,
  deckVm,
  timeMachineVm,
} from '../src/app/viewmodels'

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

describe('billingVm', () => {
  it('lists each active admission with a live billPreview and permittedActions.recordDeposit true for RECEPTION', async () => {
    const { engine } = await setupEngine()
    const depositPaise = rupees(1500)
    const admissionId = registerAndAdmit(engine, depositPaise)
    engine.addCharge(ADMIN, {
      admissionId,
      kind: 'PHARMACY',
      description: 'Paracetamol',
      amountPaise: rupees(200),
    })

    const vm = billingVm(engine, RECEPTION)
    expect(vm.discharged).toEqual([])
    expect(vm.active).toHaveLength(1)
    const row = vm.active[0]
    expect(row.admissionId).toBe(admissionId)
    expect(row.preview).toEqual(
      computeInvoice({
        admittedAtIso: ANCHOR_ISO,
        dischargedAtIso: ANCHOR_ISO,
        roomRatePaise: 150000,
        lines: [{ kind: 'PHARMACY', description: 'Paracetamol', amountPaise: rupees(200) }],
        depositPaise,
      }),
    )
    expect(vm.permittedActions.recordDeposit).toBe(true)
  })

  it('permittedActions.recordDeposit is false for a role without RECORD_DEPOSIT (DOCTOR)', async () => {
    const { engine } = await setupEngine()
    const vm = billingVm(engine, DOCTOR)
    expect(vm.permittedActions.recordDeposit).toBe(false)
  })

  it('moves a discharged admission from active to discharged with the frozen invoiceFor', async () => {
    const { engine } = await setupEngine()
    const admissionId = registerAndAdmit(engine, rupees(100000))
    engine.discharge(ADMIN, { admissionId })

    const vm = billingVm(engine, ADMIN)
    expect(vm.active).toEqual([])
    expect(vm.discharged).toHaveLength(1)
    const row = vm.discharged[0]
    expect(row.admissionId).toBe(admissionId)
    expect(row.invoice.issuedAt).toBe(ANCHOR_ISO)
    expect(row.invoice.isRefund).toBe(true)
  })

  it('is stable with no admissions at all', async () => {
    const { engine } = await setupEngine()
    const vm = billingVm(engine, ADMIN)
    expect(vm.active).toEqual([])
    expect(vm.discharged).toEqual([])
  })
})

describe('payrollVm', () => {
  it('wraps every staff row as a StaffMember instance whose breakdown sums to monthlyPay, and totals payrollTotal', async () => {
    const { engine } = await setupEngine()
    engine.addStaff(ADMIN, {
      name: 'Dr. Smith',
      type: 'DOCTOR',
      department: 'Cardiology',
      base_paise: rupees(180000),
      years_service: 6,
      specialty: 'Cardiology',
      icu_assigned: 0,
      night_shifts: 0,
      on_call: 0,
      joined_at: ANCHOR_ISO,
    })
    engine.addStaff(ADMIN, {
      name: 'Nurse Jane',
      type: 'NURSE',
      department: 'ICU',
      base_paise: rupees(52000),
      years_service: 2,
      specialty: null,
      icu_assigned: 1,
      night_shifts: 0,
      on_call: 0,
      joined_at: ANCHOR_ISO,
    })

    const vm = payrollVm(engine)
    expect(vm.rows).toHaveLength(2)

    const doctorRow = vm.rows.find((r) => r.member instanceof Doctor)!
    expect(doctorRow.roleLabel).toBe('DOCTOR')
    expect(doctorRow.monthlyPaise).toBe(doctorRow.member.monthlyPay())
    expect(doctorRow.breakdown).toEqual(payBreakdown(doctorRow.member))
    expect(doctorRow.breakdown.reduce((s, l) => s + l.amountPaise, 0)).toBe(doctorRow.monthlyPaise)

    const total = vm.rows.reduce((s, r) => s + r.monthlyPaise, 0)
    expect(vm.totalPaise).toBe(total)
  })

  it('is stable with no staff at all', async () => {
    const { engine } = await setupEngine()
    const vm = payrollVm(engine)
    expect(vm.rows).toEqual([])
    expect(vm.totalPaise).toBe(0)
  })
})

describe('auditPageVm', () => {
  const USERS = [
    { id: 1, username: 'admin', role: 'ADMIN' as const },
    { id: 2, username: 'reception', role: 'RECEPTION' as const },
  ]

  function fixtureEvents(): EventRow[] {
    return [
      { id: 5, at: '2026-08-05T00:00:00.000Z', actorUserId: 1, action: 'DISCHARGED', entity: 'admission', entityId: 10, payload: '{"a":1}' },
      { id: 4, at: '2026-08-04T00:00:00.000Z', actorUserId: null, action: 'STAFF_ADDED', entity: 'staff', entityId: 3, payload: '{"b":2}' },
      { id: 3, at: '2026-08-03T00:00:00.000Z', actorUserId: 2, action: 'ADMITTED', entity: 'admission', entityId: 10, payload: '{"c":3}' },
      { id: 2, at: '2026-08-02T00:00:00.000Z', actorUserId: 99, action: 'CHARGE_ADDED', entity: 'charge', entityId: 5, payload: '{"d":4}' },
      { id: 1, at: '2026-08-01T00:00:00.000Z', actorUserId: 1, action: 'ADMITTED', entity: 'admission', entityId: 9, payload: `{"long":"${'x'.repeat(100)}"}` },
    ]
  }

  it('paginates newest-first input at the given page size, with correct hasNext/hasPrev/totalPages', () => {
    const vm = auditPageVm(fixtureEvents(), USERS, { page: 1, pageSize: 2 })
    expect(vm.rows.map((r) => r.id)).toEqual([5, 4])
    expect(vm.totalCount).toBe(5)
    expect(vm.totalPages).toBe(3)
    expect(vm.page).toBe(1)
    expect(vm.hasPrev).toBe(false)
    expect(vm.hasNext).toBe(true)
  })

  it('page 2 and the final partial page 3', () => {
    const events = fixtureEvents()
    const page2 = auditPageVm(events, USERS, { page: 2, pageSize: 2 })
    expect(page2.rows.map((r) => r.id)).toEqual([3, 2])
    expect(page2.hasPrev).toBe(true)
    expect(page2.hasNext).toBe(true)

    const page3 = auditPageVm(events, USERS, { page: 3, pageSize: 2 })
    expect(page3.rows.map((r) => r.id)).toEqual([1])
    expect(page3.hasPrev).toBe(true)
    expect(page3.hasNext).toBe(false)
  })

  it('clamps an out-of-range page into [1, totalPages]', () => {
    const events = fixtureEvents()
    expect(auditPageVm(events, USERS, { page: 0, pageSize: 2 }).page).toBe(1)
    expect(auditPageVm(events, USERS, { page: 999, pageSize: 2 }).page).toBe(3)
  })

  it('filters by action and recomputes totals against the filtered set', () => {
    const vm = auditPageVm(fixtureEvents(), USERS, { page: 1, pageSize: 50, actionFilter: 'ADMITTED' })
    expect(vm.rows.map((r) => r.id)).toEqual([3, 1])
    expect(vm.totalCount).toBe(2)
    expect(vm.totalPages).toBe(1)
  })

  it('ALL (or omitted) actionFilter includes every action', () => {
    const vm = auditPageVm(fixtureEvents(), USERS, { page: 1, pageSize: 50, actionFilter: 'ALL' })
    expect(vm.totalCount).toBe(5)
  })

  it('resolves actorUserId to username, null to "system", and an unknown id to a fallback label', () => {
    const vm = auditPageVm(fixtureEvents(), USERS, { page: 1, pageSize: 50 })
    const byId = new Map(vm.rows.map((r) => [r.id, r]))
    expect(byId.get(5)!.actorUsername).toBe('admin')
    expect(byId.get(4)!.actorUsername).toBe('system')
    expect(byId.get(3)!.actorUsername).toBe('reception')
    expect(byId.get(2)!.actorUsername).toBe('user#99')
  })

  it('summarizes long payloads to ~80 chars while payloadPretty carries the full pretty-printed JSON', () => {
    const vm = auditPageVm(fixtureEvents(), USERS, { page: 1, pageSize: 50 })
    const longRow = vm.rows.find((r) => r.id === 1)!
    expect(longRow.payloadSummary.length).toBeLessThanOrEqual(81) // 80 chars + ellipsis
    expect(longRow.payloadPretty).toBe(JSON.stringify(JSON.parse(fixtureEvents()[4].payload), null, 2))
    expect(longRow.payloadPretty.length).toBeGreaterThan(longRow.payloadSummary.length)
  })

  it('lists distinct available actions across the full (unpaginated, unfiltered) input, sorted', () => {
    const vm = auditPageVm(fixtureEvents(), USERS, { page: 1, pageSize: 2, actionFilter: 'ADMITTED' })
    expect(vm.availableActions).toEqual(['ADMITTED', 'CHARGE_ADDED', 'DISCHARGED', 'STAFF_ADDED'])
  })

  it('is stable on an empty event list', () => {
    const vm = auditPageVm([], USERS, { page: 1 })
    expect(vm.rows).toEqual([])
    expect(vm.totalCount).toBe(0)
    expect(vm.totalPages).toBe(1)
    expect(vm.hasNext).toBe(false)
    expect(vm.hasPrev).toBe(false)
    expect(vm.availableActions).toEqual([])
  })
})

describe('deckVm', () => {
  it('is stable with no admissions at all — zeros throughout, all four wards present', async () => {
    const { engine } = await setupEngine()
    const vm = deckVm(engine)
    expect(vm.census).toEqual({ patients: 0, active: 0, bedsTotal: 2, bedsFree: 2 })
    expect(vm.occupancyByWard.map((r) => r.ward)).toEqual(['GENERAL', 'TWIN', 'PRIVATE', 'ICU'])
    expect(vm.occupancyByWard.find((r) => r.ward === 'GENERAL')).toEqual({
      ward: 'GENERAL',
      bedsTotal: 2,
      occupied: 0,
      free: 2,
    })
    expect(vm.revenueByKind).toEqual([
      { kind: 'PROCEDURE', totalPaise: 0 },
      { kind: 'PHARMACY', totalPaise: 0 },
      { kind: 'CONSULTATION', totalPaise: 0 },
      { kind: 'TRANSPORT', totalPaise: 0 },
    ])
    expect(vm.outstandingPaise).toBe(0)
    expect(vm.refundCount).toBe(0)
    expect(vm.recentEvents).toEqual([])
  })

  it('an active (not yet discharged) admission occupies its bed but contributes no revenue/outstanding — only a frozen invoice does', async () => {
    const { engine } = await setupEngine()
    const admissionId = registerAndAdmit(engine, rupees(5000), 1)
    engine.addCharge(ADMIN, {
      admissionId,
      kind: 'PHARMACY',
      description: 'Paracetamol',
      amountPaise: rupees(200),
    })

    const vm = deckVm(engine)
    expect(vm.census.active).toBe(1)
    expect(vm.occupancyByWard.find((r) => r.ward === 'GENERAL')?.occupied).toBe(1)
    // Accrued but not yet realized — deckVm only counts frozen (discharged) invoices.
    expect(vm.revenueByKind.every((r) => r.totalPaise === 0)).toBe(true)
    expect(vm.outstandingPaise).toBe(0)
    expect(vm.refundCount).toBe(0)
  })

  it('sums revenue by kind and outstanding balance across discharged invoices, and counts refunds', async () => {
    const { engine } = await setupEngine()

    // Admission 1: charges realize a positive outstanding balance (deposit < total).
    const a1 = registerAndAdmit(engine, rupees(100), 1)
    engine.addCharge(ADMIN, { admissionId: a1, kind: 'PHARMACY', description: 'Paracetamol', amountPaise: rupees(200) })
    engine.addCharge(ADMIN, { admissionId: a1, kind: 'PROCEDURE', description: 'X-ray', amountPaise: rupees(500) })
    engine.discharge(ADMIN, { admissionId: a1 })

    // Admission 2: over-deposit — a refund, no outstanding balance contribution.
    const a2 = registerAndAdmit(engine, rupees(100000), 2)
    engine.addCharge(ADMIN, { admissionId: a2, kind: 'CONSULTATION', description: 'Follow-up', amountPaise: rupees(300) })
    engine.discharge(ADMIN, { admissionId: a2 })

    const vm = deckVm(engine)
    const invoice1 = engine.invoiceFor(a1)!
    const invoice2 = engine.invoiceFor(a2)!
    expect(invoice1.isRefund).toBe(false)
    expect(invoice2.isRefund).toBe(true)

    const pharmacy = vm.revenueByKind.find((r) => r.kind === 'PHARMACY')!
    const procedure = vm.revenueByKind.find((r) => r.kind === 'PROCEDURE')!
    const consultation = vm.revenueByKind.find((r) => r.kind === 'CONSULTATION')!
    expect(pharmacy.totalPaise).toBe(rupees(200))
    expect(procedure.totalPaise).toBe(rupees(500))
    expect(consultation.totalPaise).toBe(rupees(300))

    expect(vm.outstandingPaise).toBe(invoice1.balancePaise)
    expect(vm.refundCount).toBe(1)
  })

  it('recentEvents mirrors engine.eventsLog(10) — newest-first, capped at 10', async () => {
    const { engine } = await setupEngine()
    for (let i = 0; i < 15; i++) {
      registerAndAdmit(engine, rupees(100), i % 2 === 0 ? 1 : 2)
      // each admit discharges the other bed's occupant first isn't needed —
      // registerPatient + admit both append events regardless of outcome,
      // and admit only succeeds while its bed is free, so alternate beds.
      const active = engine.admissionsActive().find((a) => a.bedId === (i % 2 === 0 ? 1 : 2))
      if (active) engine.discharge(ADMIN, { admissionId: active.id })
    }
    const vm = deckVm(engine)
    expect(vm.recentEvents).toHaveLength(10)
    expect(vm.recentEvents).toEqual(engine.eventsLog(10))
    // newest-first: descending ids
    const ids = vm.recentEvents.map((e) => e.id)
    expect(ids).toEqual([...ids].sort((a, b) => b - a))
  })
})

describe('timeMachineVm', () => {
  /**
   * A short scripted history through the real Engine — patient register,
   * admit, a charge, discharge — each step separated by a clock advance so
   * uptoIso markers land strictly between events. Returns the db/events/
   * beds a real TimeMachine screen would fetch once on mount, plus the
   * marker instants the tests scrub to.
   */
  async function buildScript() {
    const db = await Db.fresh()
    const clock = new FixedClock(ANCHOR_ISO)
    const engine = new Engine(db, clock)
    db.run(`INSERT INTO beds (id,label,ward,rate_paise) VALUES (1,'G1','GENERAL',150000)`)
    db.run(`INSERT INTO beds (id,label,ward,rate_paise) VALUES (2,'G2','GENERAL',150000)`)

    const patientId = engine.registerPatient(ADMIN, {
      name: 'Asha Rao',
      gender: 'F',
      dobIso: '1990-01-01',
      phone: '9990000001',
      idLast4: '1234',
    })
    const beforeAdmitIso = clock.now().toISOString()

    clock.advanceMinutes(10)
    const admissionId = engine.admit(ADMIN, {
      patientId,
      bedId: 1,
      diagnosis: 'Fever',
      depositPaise: rupees(100),
    })
    const midAdmissionIso = clock.now().toISOString()

    clock.advanceMinutes(10)
    engine.addCharge(ADMIN, {
      admissionId,
      kind: 'PHARMACY',
      description: 'Paracetamol',
      amountPaise: rupees(500),
    })

    clock.advanceMinutes(10)
    engine.discharge(ADMIN, { admissionId })
    const endIso = clock.now().toISOString()

    const events = engine.eventsLog()
    const beds = engine.beds().map((b) => ({ id: b.id, label: b.label, ward: b.ward, ratePaise: b.ratePaise }))

    return { db, engine, events, beds, beforeAdmitIso, midAdmissionIso, endIso, admissionId, patientId }
  }

  it('at the start (before any admission): 0 active admissions, no revenue, every bed free', async () => {
    const { events, beds, beforeAdmitIso } = await buildScript()
    const vm = timeMachineVm(events, beds, beforeAdmitIso)
    expect(vm.activeAdmissions).toBe(0)
    expect(vm.bedsFree).toBe(2)
    expect(vm.revenueToDatePaise).toBe(0)
    expect(vm.refundsToDate).toBe(0)
    expect(vm.beds.every((b) => !b.occupied)).toBe(true)
    // The patient was already registered before this marker.
    expect(vm.patients).toBe(1)
  })

  it('mid-stay: the admission is active, its bed shows occupied, still no revenue (not yet discharged)', async () => {
    const { events, beds, midAdmissionIso } = await buildScript()
    const vm = timeMachineVm(events, beds, midAdmissionIso)
    expect(vm.activeAdmissions).toBe(1)
    expect(vm.bedsFree).toBe(1)
    expect(vm.beds.find((b) => b.id === 1)?.occupied).toBe(true)
    expect(vm.beds.find((b) => b.id === 2)?.occupied).toBe(false)
    expect(vm.revenueToDatePaise).toBe(0)
  })

  it('at the end: matches the live engine state exactly (0 active, revenue == the frozen invoice total)', async () => {
    const { engine, events, beds, endIso, admissionId } = await buildScript()
    const vm = timeMachineVm(events, beds, endIso)

    expect(vm.activeAdmissions).toBe(engine.admissionsActive().length)
    expect(vm.activeAdmissions).toBe(0)
    expect(vm.patients).toBe(engine.census().patients)
    expect(vm.bedsFree).toBe(engine.census().bedsFree)

    const invoice = engine.invoiceFor(admissionId)!
    expect(vm.revenueToDatePaise).toBe(addP(invoice.roomTotalPaise, invoice.extrasTotalPaise))
    expect(vm.refundsToDate).toBe(invoice.isRefund ? 1 : 0)
  })

  it('never touches the db while scrubbing — poisoned-Db-facade probe', async () => {
    const { db, events, beds, beforeAdmitIso, midAdmissionIso, endIso } = await buildScript()

    // events/beds are already fetched (the one-time fetch a real TimeMachine
    // screen does on mount). From here on, any further db access is a
    // purity violation — poison the real Db's read/write surface and prove
    // scrubbing across the whole range never touches it.
    const poison = (): never => {
      throw new Error('timeMachineVm touched the db — it must be a pure fold over pre-fetched events/beds')
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poisoned = db as any
    poisoned.run = poison
    poisoned.all = poison
    poisoned.get = poison

    expect(() => timeMachineVm(events, beds, beforeAdmitIso)).not.toThrow()
    expect(() => timeMachineVm(events, beds, midAdmissionIso)).not.toThrow()
    expect(() => timeMachineVm(events, beds, endIso)).not.toThrow()

    const vmStart = timeMachineVm(events, beds, beforeAdmitIso)
    const vmMid = timeMachineVm(events, beds, midAdmissionIso)
    const vmEnd = timeMachineVm(events, beds, endIso)
    expect(vmStart.activeAdmissions).toBe(0)
    expect(vmMid.activeAdmissions).toBe(1)
    expect(vmEnd.activeAdmissions).toBe(0)
    // Deposit ₹100 < ₹1,500 room (1 night) + ₹500 pharmacy — a balance due, not a refund.
    expect(vmEnd.refundsToDate).toBe(0)
  })
})
