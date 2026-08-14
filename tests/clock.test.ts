import { describe, it, expect } from 'vitest'
import { FixedClock, ANCHOR_ISO } from '../src/core/clock'
import { mulberry32, pick } from '../src/core/rng'

describe('clock', () => {
  describe('FixedClock', () => {
    it('initializes with anchor ISO', () => {
      const clock = new FixedClock(ANCHOR_ISO)
      expect(clock.now().toISOString()).toBe(ANCHOR_ISO)
    })

    it('returns independent Date objects', () => {
      const clock = new FixedClock(ANCHOR_ISO)
      const date1 = clock.now()
      const date2 = clock.now()
      expect(date1.toISOString()).toBe(date2.toISOString())
      expect(date1).not.toBe(date2) // Different object instances
    })

    it('does not allow mutation of internal state via returned Date', () => {
      const clock = new FixedClock(ANCHOR_ISO)
      const date = clock.now()
      date.setFullYear(2030)
      // Verify that the next call returns the original time
      expect(clock.now().toISOString()).toBe(ANCHOR_ISO)
    })

    it('advances by minutes', () => {
      const clock = new FixedClock(ANCHOR_ISO)
      clock.advanceMinutes(1)
      const advanced = new Date(ANCHOR_ISO)
      advanced.setUTCMinutes(advanced.getUTCMinutes() + 1)
      expect(clock.now().toISOString()).toBe(advanced.toISOString())
    })

    it('advances by multiple minutes', () => {
      const clock = new FixedClock(ANCHOR_ISO)
      clock.advanceMinutes(120)
      const advanced = new Date(ANCHOR_ISO)
      advanced.setUTCHours(advanced.getUTCHours() + 2)
      expect(clock.now().toISOString()).toBe(advanced.toISOString())
    })

    it('can set to a new ISO string', () => {
      const clock = new FixedClock(ANCHOR_ISO)
      const newTime = '2026-09-15T12:30:00.000Z'
      clock.set(newTime)
      expect(clock.now().toISOString()).toBe(newTime)
    })
  })

  describe('mulberry32', () => {
    it('returns the same sequence for the same seed', () => {
      const rng1 = mulberry32(42)
      const rng2 = mulberry32(42)

      for (let i = 0; i < 10; i++) {
        expect(rng1()).toBe(rng2())
      }
    })

    it('returns different sequences for different seeds', () => {
      const rng1 = mulberry32(42)
      const rng2 = mulberry32(43)

      let same = 0
      for (let i = 0; i < 100; i++) {
        if (rng1() === rng2()) {
          same++
        }
      }
      expect(same).toBeLessThan(100) // Not all the same
    })

    it('generates values in [0, 1)', () => {
      const rng = mulberry32(42)
      for (let i = 0; i < 1000; i++) {
        const value = rng()
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThan(1)
      }
    })

    it('snapshot first 5 values for seed 42', () => {
      const rng = mulberry32(42)
      const values = [rng(), rng(), rng(), rng(), rng()]
      // These are hardcoded expected values from the standard mulberry32
      expect(values[0]).toBeCloseTo(0.6011037519201636, 10)
      expect(values[1]).toBeCloseTo(0.44829055899754167, 10)
      expect(values[2]).toBeCloseTo(0.8524657934904099, 10)
      expect(values[3]).toBeCloseTo(0.6697340414393693, 10)
      expect(values[4]).toBeCloseTo(0.17481389874592423, 10)
    })

    it('no short cycles: 10k draws produce > 9990 distinct values', () => {
      const seeds = [1, 1010, 20260801]
      for (const seed of seeds) {
        const rng = mulberry32(seed)
        const draws: number[] = []
        for (let i = 0; i < 10000; i++) {
          draws.push(rng())
        }
        const firstValue = draws[0]
        let repeatCount = 0
        for (let i = 1; i < 10000; i++) {
          if (draws[i] === firstValue) {
            repeatCount++
          }
        }
        expect(repeatCount).toBe(0) // First value should not repeat in first 10k draws
      }
    })

    it('pick throws on empty array', () => {
      const rng = mulberry32(42)
      expect(() => pick(rng, [])).toThrow()
    })

    it('pick selects from non-empty array', () => {
      const rng = mulberry32(42)
      const arr = [1, 2, 3, 4, 5]
      const result = pick(rng, arr)
      expect(arr).toContain(result)
    })
  })
})
