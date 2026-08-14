import { describe, it, expect } from 'vitest'
import { MATRIX, can, type Role, type Permission } from '../src/core/permissions'

describe('permissions', () => {
  describe('can', () => {
    it("can('DOCTOR','DISCHARGE') === false", () => {
      expect(can('DOCTOR', 'DISCHARGE')).toBe(false)
    })

    it("can('RECEPTION','ADMIT') === true", () => {
      expect(can('RECEPTION', 'ADMIT')).toBe(true)
    })

    it("can('ADMIN','MANAGE_USERS') === true", () => {
      expect(can('ADMIN', 'MANAGE_USERS')).toBe(true)
    })
  })

  describe('permission matrix exhaustive', () => {
    // All permissions
    const allPermissions: Permission[] = [
      'REGISTER_PATIENT',
      'ADMIT',
      'TRANSFER',
      'DISCHARGE',
      'ADD_CHARGE',
      'RECORD_DEPOSIT',
      'DISPATCH_AMBULANCE',
      'RETURN_AMBULANCE',
      'VIEW_CLINICAL',
      'VIEW_BILLING',
      'MANAGE_USERS',
    ]

    // All roles
    const allRoles: Role[] = ['ADMIN', 'RECEPTION', 'DOCTOR', 'NURSE', 'BILLING']

    // Expected matrix: role -> permission -> boolean
    const expectedMatrix: Record<Role, Record<Permission, boolean>> = {
      ADMIN: {
        REGISTER_PATIENT: true,
        ADMIT: true,
        TRANSFER: true,
        DISCHARGE: true,
        ADD_CHARGE: true,
        RECORD_DEPOSIT: true,
        DISPATCH_AMBULANCE: true,
        RETURN_AMBULANCE: true,
        VIEW_CLINICAL: true,
        VIEW_BILLING: true,
        MANAGE_USERS: true,
      },
      RECEPTION: {
        REGISTER_PATIENT: true,
        ADMIT: true,
        TRANSFER: true,
        DISCHARGE: true,
        ADD_CHARGE: false,
        RECORD_DEPOSIT: true,
        DISPATCH_AMBULANCE: true,
        RETURN_AMBULANCE: true,
        VIEW_CLINICAL: true,
        VIEW_BILLING: false,
        MANAGE_USERS: false,
      },
      DOCTOR: {
        REGISTER_PATIENT: false,
        ADMIT: false,
        TRANSFER: false,
        DISCHARGE: false,
        ADD_CHARGE: true,
        RECORD_DEPOSIT: false,
        DISPATCH_AMBULANCE: false,
        RETURN_AMBULANCE: false,
        VIEW_CLINICAL: true,
        VIEW_BILLING: false,
        MANAGE_USERS: false,
      },
      NURSE: {
        REGISTER_PATIENT: false,
        ADMIT: false,
        TRANSFER: false,
        DISCHARGE: false,
        ADD_CHARGE: false,
        RECORD_DEPOSIT: false,
        DISPATCH_AMBULANCE: false,
        RETURN_AMBULANCE: false,
        VIEW_CLINICAL: true,
        VIEW_BILLING: false,
        MANAGE_USERS: false,
      },
      BILLING: {
        REGISTER_PATIENT: false,
        ADMIT: false,
        TRANSFER: false,
        DISCHARGE: false,
        ADD_CHARGE: true,
        RECORD_DEPOSIT: true,
        DISPATCH_AMBULANCE: false,
        RETURN_AMBULANCE: false,
        VIEW_CLINICAL: false,
        VIEW_BILLING: true,
        MANAGE_USERS: false,
      },
    }

    it('MATRIX matches expected structure for all roles and permissions', () => {
      for (const role of allRoles) {
        expect(MATRIX).toHaveProperty(role)
        expect(MATRIX[role]).toBeInstanceOf(Set)
      }
    })

    it('exhaustive spot check: MATRIX role->permission assignments', () => {
      for (const role of allRoles) {
        for (const permission of allPermissions) {
          const expected = expectedMatrix[role][permission]
          const actual = MATRIX[role].has(permission)
          expect(actual).toBe(expected, `${role} should ${expected ? 'have' : 'not have'} ${permission}`)
        }
      }
    })

    it('can() function reflects MATRIX correctly', () => {
      for (const role of allRoles) {
        for (const permission of allPermissions) {
          const expected = MATRIX[role].has(permission)
          const actual = can(role, permission)
          expect(actual).toBe(expected, `can('${role}', '${permission}') should be ${expected}`)
        }
      }
    })
  })
})
