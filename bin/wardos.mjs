#!/usr/bin/env node
// Thin loader for the wardos CLI (src/cli/main.ts).
//
// src/cli/main.ts is TypeScript, imported through the project's own
// extensionless, unbundled ES module imports (src/core, src/db, src/seed —
// the same modules Vitest already runs successfully in every existing
// test). Plain `node` can't resolve those imports or strip the TypeScript,
// and `tsx` isn't a project dependency, so — exactly like
// scripts/run-benchmark.mjs — this spawns `vite-node`, Vitest's own module
// runner (already installed as part of the `vitest` devDependency), to get
// the same proven module resolution and TS transform, without adding a
// dependency or a second `tsc` build pipeline. vite-node also resolves
// database.ts's Node-vs-browser wasm/`?raw` schema loading the same way
// Vitest does, so the CLI shares that logic instead of duplicating it.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(repoRoot, 'src/cli/main.ts')

const viteNodeBin = join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'vite-node.cmd' : 'vite-node')
const bin = existsSync(viteNodeBin) ? viteNodeBin : 'vite-node'

const result = spawnSync(bin, [entry, ...process.argv.slice(2)], { stdio: 'inherit', cwd: repoRoot })

if (result.error) {
  console.error(result.error)
  process.exit(1)
}
process.exit(result.status ?? 1)
