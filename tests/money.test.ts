import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { paise, rupees, addP, subP, mulP, sumP, formatINR } from '../src/core/money'

describe('money', () => {
  describe('paise', () => {
    it('accepts safe integers', () => {
      expect(paise(0)).toBe(0)
      expect(paise(100)).toBe(100)
      expect(paise(-50)).toBe(-50)
    })

    it('rejects non-integers', () => {
      expect(() => paise(1.5)).toThrow()
      expect(() => paise(Math.PI)).toThrow()
    })

    it('rejects unsafe integers', () => {
      expect(() => paise(Number.MAX_SAFE_INTEGER + 1)).toThrow()
    })
  })

  describe('rupees', () => {
    it('converts rupees to paise exactly', () => {
      expect(rupees(100)).toBe(10000)
      expect(rupees(1500)).toBe(150000)
      expect(rupees(0)).toBe(0)
    })

    it('accepts paise-precise values', () => {
      expect(rupees(1.5)).toBe(150)
      expect(rupees(49.99)).toBe(4999)
      expect(rupees(100)).toBe(10000)
      expect(rupees(100.1)).toBe(10010)
    })

    it('rejects non-paise-precise values', () => {
      expect(() => rupees(10.001)).toThrow()
      expect(() => rupees(0.001)).toThrow()
      expect(() => rupees(1.23456)).toThrow()
    })

    it('accepts large integer rupee values', () => {
      const largeRupees = 90071992547409
      expect(rupees(largeRupees)).toBe(largeRupees * 100)
    })
  })

  describe('addP', () => {
    it('adds two paise values', () => {
      expect(addP(100, 200)).toBe(300)
      expect(addP(-50, 100)).toBe(50)
      expect(addP(0, 0)).toBe(0)
    })
  })

  describe('subP', () => {
    it('subtracts two paise values', () => {
      expect(subP(300, 100)).toBe(200)
      expect(subP(100, 300)).toBe(-200)
      expect(subP(0, 0)).toBe(0)
    })
  })

  describe('mulP', () => {
    it('multiplies paise by non-negative integers', () => {
      expect(mulP(100, 0)).toBe(0)
      expect(mulP(100, 1)).toBe(100)
      expect(mulP(100, 10)).toBe(1000)
    })

    it('rejects negative multipliers', () => {
      expect(() => mulP(100, -1)).toThrow()
    })

    it('rejects non-integer multipliers', () => {
      expect(() => mulP(100, 1.5)).toThrow()
    })

    it('rejects unsafe integer multipliers', () => {
      expect(() => mulP(100, Number.MAX_SAFE_INTEGER + 1)).toThrow()
    })
  })

  describe('sumP', () => {
    it('sums an array of paise', () => {
      expect(sumP([])).toBe(0)
      expect(sumP([100])).toBe(100)
      expect(sumP([100, 200, 300])).toBe(600)
    })

    it('handles negative values', () => {
      expect(sumP([100, -50, 200])).toBe(250)
    })

    it('no drift over 10k additions', () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 0, max: 10_000_000 }), { maxLength: 10_000 }),
          (xs) => sumP(xs) === xs.reduce((a, b) => a + b, 0)
        )
      )
    })
  })

  describe('formatINR', () => {
    it('formats positive amounts with Indian grouping', () => {
      expect(formatINR(0)).toBe('₹0.00')
      expect(formatINR(100)).toBe('₹1.00')
      expect(formatINR(10000)).toBe('₹100.00')
      expect(formatINR(207820000)).toBe('₹20,78,200.00')
      expect(formatINR(1234567890)).toBe('₹1,23,45,678.90')
    })

    it('formats negative amounts with minus sign', () => {
      expect(formatINR(-100)).toBe('−₹1.00')
      expect(formatINR(-5000)).toBe('−₹50.00')
      expect(formatINR(-207820000)).toBe('−₹20,78,200.00')
    })

    it('always shows two decimal places', () => {
      expect(formatINR(1)).toBe('₹0.01')
      expect(formatINR(99)).toBe('₹0.99')
      expect(formatINR(100000)).toBe('₹1,000.00')
    })
  })

  describe('distributivity', () => {
    it('mulP distributes over addP', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 1e6 }),
          fc.integer({ min: 0, max: 1e6 }),
          fc.integer({ min: 0, max: 1000 }),
          (a, b, n) => mulP(addP(a, b), n) === addP(mulP(a, n), mulP(b, n))
        )
      )
    })
  })
})
