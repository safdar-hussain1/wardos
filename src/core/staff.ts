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

export interface PayLine {
  label: string
  amountPaise: Paise
}

/**
 * Pure itemization of a staff member's monthlyPay() arithmetic — one line
 * per term of their own subclass's rule, in the same order/amounts the
 * class's monthlyPay() computes them. `sum(lines) === member.monthlyPay()`
 * always (see tests/payroll.test.ts's property test across every staff
 * type and both branches of each type's conditional allowance).
 */
export function payBreakdown(member: StaffMember): PayLine[] {
  const lines: PayLine[] = [{ label: 'Base', amountPaise: member.basePaise }]

  if (member instanceof Doctor) {
    const specialtyAllowance = Math.floor((member.basePaise * 30) / 100)
    lines.push({ label: `Specialty allowance (30%, ${member.specialty})`, amountPaise: specialtyAllowance })
    if (member.yearsService >= 5) {
      const bonus = Math.floor((member.basePaise * 10) / 100)
      lines.push({ label: 'Tenure bonus (10%, ≥5 years service)', amountPaise: bonus })
    }
  } else if (member instanceof Nurse) {
    if (member.icuAssigned) {
      const icuAllowance = Math.floor((member.basePaise * 20) / 100)
      lines.push({ label: 'ICU allowance (20%)', amountPaise: icuAllowance })
    }
  } else if (member instanceof Technician) {
    if (member.nightShifts > 0) {
      const nightDifferential = 40_000 * member.nightShifts
      lines.push({
        label: `Night differential (₹400 × ${member.nightShifts} shift${member.nightShifts === 1 ? '' : 's'})`,
        amountPaise: nightDifferential,
      })
    }
  } else if (member instanceof Driver) {
    if (member.onCall) {
      lines.push({ label: 'On-call allowance', amountPaise: 600_000 })
    }
  }
  // AdminStaff: base only — no further lines.

  return lines
}
