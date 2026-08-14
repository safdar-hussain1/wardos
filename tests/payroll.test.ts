import { describe, it, expect } from 'vitest'
import {
  Doctor,
  Nurse,
  Technician,
  Driver,
  AdminStaff,
  staffFromRow,
  payrollTotal,
} from '../src/core/staff'
import { rupees } from '../src/core/money'

describe('payroll', () => {
  describe('Doctor', () => {
    it('computes monthly pay: base + 30% specialty + 10% (years >= 5)', () => {
      // base ₹1,80,000, specialty ₹54,000, bonus ₹18,000 = ₹2,52,000 = 25,200,000 paise
      const doc = new Doctor(1, 'Dr. Smith', 'Cardiology', rupees(180000), 6, 'Cardiology')
      expect(doc.monthlyPay()).toBe(25_200_000)
    })

    it('computes monthly pay without bonus if years < 5', () => {
      // base ₹1,80,000, specialty ₹54,000, no bonus = ₹2,34,000
      const doc = new Doctor(1, 'Dr. Smith', 'Cardiology', rupees(180000), 3, 'Cardiology')
      expect(doc.monthlyPay()).toBe(23_400_000)
    })

    it('has roleLabel', () => {
      const doc = new Doctor(1, 'Dr. Smith', 'Cardiology', rupees(180000), 6, 'Cardiology')
      expect(doc.roleLabel()).toBe('DOCTOR')
    })
  })

  describe('Nurse', () => {
    it('computes monthly pay: base + 20% (if ICU assigned)', () => {
      // base ₹52,000 + 20% = ₹62,400 = 6,240,000 paise
      const nurse = new Nurse(1, 'Nurse Jane', 'ICU', rupees(52000), 2, true)
      expect(nurse.monthlyPay()).toBe(6_240_000)
    })

    it('computes monthly pay without ICU allowance', () => {
      // base ₹52,000 = 5,200,000 paise
      const nurse = new Nurse(1, 'Nurse Jane', 'General', rupees(52000), 2, false)
      expect(nurse.monthlyPay()).toBe(5_200_000)
    })

    it('has roleLabel', () => {
      const nurse = new Nurse(1, 'Nurse Jane', 'ICU', rupees(52000), 2, true)
      expect(nurse.roleLabel()).toBe('NURSE')
    })
  })

  describe('Technician', () => {
    it('computes monthly pay: base + 40_000 paise × nightShifts', () => {
      // base ₹50,000 + 40_000 * 3 shifts = 5,000,000 + 120,000 = 5,120,000 paise
      const tech = new Technician(1, 'Tech John', 'Lab', rupees(50000), 4, 3)
      expect(tech.monthlyPay()).toBe(5_120_000)
    })

    it('computes monthly pay with zero night shifts', () => {
      const tech = new Technician(1, 'Tech John', 'Lab', rupees(50000), 4, 0)
      expect(tech.monthlyPay()).toBe(5_000_000)
    })

    it('has roleLabel', () => {
      const tech = new Technician(1, 'Tech John', 'Lab', rupees(50000), 4, 3)
      expect(tech.roleLabel()).toBe('TECHNICIAN')
    })
  })

  describe('Driver', () => {
    it('computes monthly pay: base + 600_000 paise (if onCall)', () => {
      // base ₹48,000 + 600_000 paise = 4,800,000 + 600,000 = 5,400,000 paise
      const driver = new Driver(1, 'Driver Bob', 'Transport', rupees(48000), 5, true)
      expect(driver.monthlyPay()).toBe(5_400_000)
    })

    it('computes monthly pay without onCall allowance', () => {
      // base ₹48,000 = 4,800,000 paise
      const driver = new Driver(1, 'Driver Bob', 'Transport', rupees(48000), 5, false)
      expect(driver.monthlyPay()).toBe(4_800_000)
    })

    it('has roleLabel', () => {
      const driver = new Driver(1, 'Driver Bob', 'Transport', rupees(48000), 5, true)
      expect(driver.roleLabel()).toBe('DRIVER')
    })
  })

  describe('AdminStaff', () => {
    it('computes monthly pay: base only', () => {
      // base ₹35,000 = 3,500,000 paise
      const admin = new AdminStaff(1, 'Admin Alice', 'Administration', rupees(35000), 2)
      expect(admin.monthlyPay()).toBe(3_500_000)
    })

    it('has roleLabel', () => {
      const admin = new AdminStaff(1, 'Admin Alice', 'Administration', rupees(35000), 2)
      expect(admin.roleLabel()).toBe('ADMIN_STAFF')
    })
  })

  describe('staffFromRow', () => {
    it('creates Doctor from row', () => {
      const row: any = {
        id: 1,
        name: 'Dr. Smith',
        type: 'DOCTOR',
        department: 'Cardiology',
        base_paise: 18_000_000,
        years_service: 6,
        specialty: 'Cardiology',
        icu_assigned: 0,
        night_shifts: 0,
        on_call: 0,
        joined_at: '2020-01-01T00:00:00.000Z',
      }
      const staff = staffFromRow(row) as Doctor
      expect(staff).toBeInstanceOf(Doctor)
      expect(staff.id).toBe(1)
      expect(staff.name).toBe('Dr. Smith')
      expect(staff.specialty).toBe('Cardiology')
      expect(staff.yearsService).toBe(6)
      expect(staff.basePaise).toBe(18_000_000)
      expect(staff.monthlyPay()).toBe(25_200_000) // base + 30% + 10% (years >= 5)
    })

    it('creates ICU Nurse from row with correct pay', () => {
      const row: any = {
        id: 2,
        name: 'Nurse Jane',
        type: 'NURSE',
        department: 'ICU',
        base_paise: 5_200_000,
        years_service: 2,
        specialty: null,
        icu_assigned: 1,
        night_shifts: 0,
        on_call: 0,
        joined_at: '2022-01-01T00:00:00.000Z',
      }
      const staff = staffFromRow(row) as Nurse
      expect(staff).toBeInstanceOf(Nurse)
      expect(staff.id).toBe(2)
      expect(staff.icuAssigned).toBe(true)
      expect(staff.yearsService).toBe(2)
      expect(staff.basePaise).toBe(5_200_000)
      expect(staff.monthlyPay()).toBe(6_240_000) // base + 20% ICU allowance
    })

    it('creates non-ICU Nurse from row', () => {
      const row: any = {
        id: 20,
        name: 'Nurse John',
        type: 'NURSE',
        department: 'General',
        base_paise: 5_200_000,
        years_service: 3,
        specialty: null,
        icu_assigned: 0,
        night_shifts: 0,
        on_call: 0,
        joined_at: '2023-01-01T00:00:00.000Z',
      }
      const staff = staffFromRow(row) as Nurse
      expect(staff).toBeInstanceOf(Nurse)
      expect(staff.icuAssigned).toBe(false)
      expect(staff.monthlyPay()).toBe(5_200_000) // base only, no ICU allowance
    })

    it('creates Technician from row with night shifts', () => {
      const row: any = {
        id: 3,
        name: 'Tech John',
        type: 'TECHNICIAN',
        department: 'Lab',
        base_paise: 5_000_000,
        years_service: 4,
        specialty: null,
        icu_assigned: 0,
        night_shifts: 3,
        on_call: 0,
        joined_at: '2021-01-01T00:00:00.000Z',
      }
      const staff = staffFromRow(row) as Technician
      expect(staff).toBeInstanceOf(Technician)
      expect(staff.id).toBe(3)
      expect(staff.nightShifts).toBe(3)
      expect(staff.yearsService).toBe(4)
      expect(staff.basePaise).toBe(5_000_000)
      expect(staff.monthlyPay()).toBe(5_120_000) // base + 40_000 * 3 night shifts
    })

    it('creates on-call Driver from row', () => {
      const row: any = {
        id: 4,
        name: 'Driver Bob',
        type: 'DRIVER',
        department: 'Transport',
        base_paise: 4_800_000,
        years_service: 5,
        specialty: null,
        icu_assigned: 0,
        night_shifts: 0,
        on_call: 1,
        joined_at: '2019-01-01T00:00:00.000Z',
      }
      const staff = staffFromRow(row) as Driver
      expect(staff).toBeInstanceOf(Driver)
      expect(staff.id).toBe(4)
      expect(staff.onCall).toBe(true)
      expect(staff.yearsService).toBe(5)
      expect(staff.basePaise).toBe(4_800_000)
      expect(staff.monthlyPay()).toBe(5_400_000) // base + 600_000 on-call allowance
    })

    it('creates non-on-call Driver from row', () => {
      const row: any = {
        id: 40,
        name: 'Driver Alice',
        type: 'DRIVER',
        department: 'Transport',
        base_paise: 4_800_000,
        years_service: 2,
        specialty: null,
        icu_assigned: 0,
        night_shifts: 0,
        on_call: 0,
        joined_at: '2024-01-01T00:00:00.000Z',
      }
      const staff = staffFromRow(row) as Driver
      expect(staff).toBeInstanceOf(Driver)
      expect(staff.onCall).toBe(false)
      expect(staff.monthlyPay()).toBe(4_800_000) // base only, no on-call allowance
    })

    it('creates AdminStaff from row', () => {
      const row: any = {
        id: 5,
        name: 'Admin Alice',
        type: 'ADMIN',
        department: 'Administration',
        base_paise: 3_500_000,
        years_service: 2,
        specialty: null,
        icu_assigned: 0,
        night_shifts: 0,
        on_call: 0,
        joined_at: '2023-01-01T00:00:00.000Z',
      }
      const staff = staffFromRow(row) as AdminStaff
      expect(staff).toBeInstanceOf(AdminStaff)
      expect(staff.id).toBe(5)
      expect(staff.yearsService).toBe(2)
      expect(staff.basePaise).toBe(3_500_000)
      expect(staff.monthlyPay()).toBe(3_500_000) // base only
    })

    it('throws on unknown type', () => {
      const row: any = {
        id: 99,
        name: 'Unknown',
        type: 'UNKNOWN_TYPE',
        department: 'Somewhere',
        base_paise: 1_000_000,
        years_service: 0,
        specialty: null,
        icu_assigned: 0,
        night_shifts: 0,
        on_call: 0,
        joined_at: '2024-01-01T00:00:00.000Z',
      }
      expect(() => staffFromRow(row)).toThrow()
    })
  })

  describe('payrollTotal', () => {
    it('sums monthly pay for mixed staff', () => {
      const doc = new Doctor(1, 'Dr. Smith', 'Cardiology', rupees(180000), 6, 'Cardiology')
      const nurse = new Nurse(2, 'Nurse Jane', 'ICU', rupees(52000), 2, true)
      const admin = new AdminStaff(3, 'Admin Alice', 'Administration', rupees(35000), 2)

      const total = payrollTotal([doc, nurse, admin])
      expect(total).toBe(25_200_000 + 6_240_000 + 3_500_000)
    })

    it('handles empty staff list', () => {
      expect(payrollTotal([])).toBe(0)
    })
  })
})
