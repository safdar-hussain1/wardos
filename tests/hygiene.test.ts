import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('repo hygiene', () => {
  it('git ignores local databases and data/', () => {
    // Ask git about this repo's .gitignore inside a throwaway repository, so the check also
    // runs in a copy that has no .git directory (a `git archive` export or a ZIP download),
    // where `git check-ignore` would have no repository to consult and could only error out.
    const scratch = mkdtempSync(join(tmpdir(), 'wardos-hygiene-'))
    try {
      expect(spawnSync('git', ['init', '-q'], { cwd: scratch }).status, 'git init').toBe(0)
      copyFileSync(join(repoRoot, '.gitignore'), join(scratch, '.gitignore'))
      for (const p of ['data/hospital.db', 'wardos.db']) {
        // exit 0 = ignored, 1 = not ignored, 128 = git error
        const status = spawnSync('git', ['check-ignore', '-q', p], { cwd: scratch }).status
        expect(status, `${p} must be git-ignored`).toBe(0)
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })
})
