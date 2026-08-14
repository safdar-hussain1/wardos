#!/usr/bin/env node
// Runs src/bench/run.ts, which seeds a fresh hospital, replays the naive
// baselines, writes src/app/data/benchmark.json, and prints the table.
//
// src/bench/run.ts is TypeScript, imported through a long chain of the
// project's own extensionless, unbundled ES module imports (src/core,
// src/seed, src/db — the same modules Vitest already runs successfully in
// all 199 existing tests). Plain `node` can't resolve those imports or
// strip the TypeScript, and `tsx` isn't a project dependency, so this
// spawns `vite-node` — Vitest's own module runner, already installed as
// part of the `vitest` devDependency — to get the exact same, already-
// proven module resolution and TS transform Vitest uses, without adding a
// new dependency or hand-rolling a resolution shim.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(repoRoot, 'src/bench/run.ts')

const viteNodeBin = join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'vite-node.cmd' : 'vite-node')
const bin = existsSync(viteNodeBin) ? viteNodeBin : 'vite-node'

const result = spawnSync(bin, [entry], { stdio: 'inherit', cwd: repoRoot })

if (result.error) {
  console.error(result.error)
  process.exit(1)
}
process.exit(result.status ?? 1)
