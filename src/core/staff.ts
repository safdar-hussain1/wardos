import type { Paise } from './money'
import { sumP } from './money'

export type StaffRow = {
  id: number
  name: string
  type: string
  department: string
  base_paise: Paise
  years_service: number
  specialty: string | null
  icu_assigned: number
  night_shifts: number
  on_call: number
  joined_at: string
}

export abstract class StaffMember {
  readonly id: number
  readonly name: string
  readonly department: string
  readonly basePaise: Paise
  readonly yearsService: number

  constructor(
    id: number,
    name: string,
    department: string,
    basePaise: Paise,
    yearsService: number,
  ) {
    this.id = id
    this.name = name
    this.department = department
    this.basePaise = basePaise
    this.yearsService = yearsService
  }

  abstract monthlyPay(): Paise
  abstract roleLabel(): string
}

export class Doctor extends StaffMember {
  readonly specialty: string

  constructor(
    id: number,
    name: string,
    department: string,
    basePaise: Paise,
    yearsService: number,
    specialty: string,
  ) {
    super(id, name, department, basePaise, yearsService)
    this.specialty = specialty
  }

  monthlyPay(): Paise {
    // base + 30% specialty + (years≥5 ? 10% of base : 0)
    let pay = this.basePaise

    // 30% specialty allowance
    const specialtyAllowance = Math.floor((this.basePaise * 30) / 100)
    pay += specialtyAllowance

    // 10% bonus if years >= 5
    if (this.yearsService >= 5) {
      const bonus = Math.floor((this.basePaise * 10) / 100)
      pay += bonus
    }

    return pay
  }

  roleLabel(): string {
    return 'DOCTOR'
  }
}

export class Nurse extends StaffMember {
  readonly icuAssigned: boolean

  constructor(
    id: number,
    name: string,
    department: string,
    basePaise: Paise,
    yearsService: number,
    icuAssigned: boolean,
  ) {
    super(id, name, department, basePaise, yearsService)
    this.icuAssigned = icuAssigned
  }

  monthlyPay(): Paise {
    // base + (icuAssigned ? 20% of base : 0)
    let pay = this.basePaise

    if (this.icuAssigned) {
      const icuAllowance = Math.floor((this.basePaise * 20) / 100)
      pay += icuAllowance
    }

    return pay
  }

  roleLabel(): string {
    return 'NURSE'
  }
}

export class Technician extends StaffMember {
  readonly nightShifts: number

  constructor(
    id: number,
    name: string,
    department: string,
    basePaise: Paise,
    yearsService: number,
    nightShifts: number,
  ) {
    super(id, name, department, basePaise, yearsService)
    this.nightShifts = nightShifts
  }

  monthlyPay(): Paise {
    // base + 40_000 paise × nightShifts
    const nightDifferential = 40_000 * this.nightShifts
    return this.basePaise + nightDifferential
  }

  roleLabel(): string {
    return 'TECHNICIAN'
  }
}

export class Driver extends StaffMember {
  readonly onCall: boolean

  constructor(
    id: number,
    name: string,
    department: string,
    basePaise: Paise,
    yearsService: number,
    onCall: boolean,
  ) {
    super(id, name, department, basePaise, yearsService)
    this.onCall = onCall
  }

  monthlyPay(): Paise {
    // base + (onCall ? 600_000 paise : 0)
    let pay = this.basePaise

    if (this.onCall) {
      pay += 600_000
    }

    return pay
  }

  roleLabel(): string {
    return 'DRIVER'
  }
}

export class AdminStaff extends StaffMember {
  constructor(
    id: number,
    name: string,
    department: string,
    basePaise: Paise,
    yearsService: number,
  ) {
    super(id, name, department, basePaise, yearsService)
  }

  monthlyPay(): Paise {
    // base only
    return this.basePaise
  }

  roleLabel(): string {
    return 'ADMIN_STAFF'
  }
}

export function staffFromRow(row: StaffRow): StaffMember {
  const { id, name, type, department, base_paise, years_service } = row

  switch (type) {
    case 'DOCTOR':
      return new Doctor(id, name, department, base_paise, years_service, row.specialty || '')

    case 'NURSE':
      return new Nurse(id, name, department, base_paise, years_service, row.icu_assigned === 1)

    case 'TECHNICIAN':
      return new Technician(id, name, department, base_paise, years_service, row.night_shifts)

    case 'DRIVER':
      return new Driver(id, name, department, base_paise, years_service, row.on_call === 1)

    case 'ADMIN':
      return new AdminStaff(id, name, department, base_paise, years_service)

    default:
      throw new Error(`Unknown staff type: ${type}`)
  }
}

export function payrollTotal(staff: StaffMember[]): Paise {
  return sumP(staff.map((s) => s.monthlyPay()))
}
