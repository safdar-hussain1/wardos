import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

/**
 * C2 (replay/time-machine) and the seed's determinism guarantee both
 * depend on every domain module being driven entirely by explicit,
 * caller-supplied timestamps/RNG — never by the wall clock or a
 * non-deterministic RNG. This scans the actual source text (not behavior)
 * of every module that must hold that invariant — src/core (FixedClock's
 * *own* `new Date(startIso)` calls always take an argument, so they don't
 * trip this), src/db, src/seed, src/naive, src/bench, and the CLI added in
 * this task (src/cli) — for the three literal patterns that would break it.
 */

const SCAN_DIRS = ['src/core', 'src/db', 'src/seed', 'src/naive', 'src/bench', 'src/cli']

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function collectTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      out.push(...collectTsFiles(full))
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full)
    }
  }
  return out
}

const files = SCAN_DIRS.flatMap((dir) => collectTsFiles(join(repoRoot, dir)))

// Several of these modules' own doc comments *name* the forbidden calls
// while explaining that the module deliberately avoids them (see e.g.
// seed.ts's and bench/run.ts's module docstrings, and src/cli/main.ts's) —
// a literal substring scan over raw source would flag that prose as a
// violation. Stripping block and line comments first means the check only
// ever looks at real code, not documentation that talks about the rule.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

describe('no-wallclock: src/core, src/db, src/seed, src/naive, src/bench, src/cli never call Date.now(), argless new Date(), or Math.random()', () => {
  it('the scan actually found source files (not vacuously passing over an empty list)', () => {
    expect(files.length).toBeGreaterThan(SCAN_DIRS.length)
  })

  it.each(files.map((f) => [f.slice(repoRoot.length + 1), f] as const))('%s', (_label, file) => {
    const src = stripComments(readFileSync(file, 'utf8'))
    expect(src.includes('Date.now(')).toBe(false)
    expect(/new Date\(\s*\)/.test(src)).toBe(false)
    expect(src.includes('Math.random(')).toBe(false)
  })
})
