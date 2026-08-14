import { execSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'

describe('repo hygiene', () => {
  it('git ignores local databases and data/', () => {
    for (const p of ['data/hospital.db', 'wardos.db']) {
      const out = execSync(`git check-ignore -q ${p} && echo IGNORED || echo TRACKED`).toString()
      expect(out.trim(), `${p} must be git-ignored`).toBe('IGNORED')
    }
  })
})
