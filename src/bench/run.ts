import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runBenchmark } from './benchmark'
import type { BenchmarkReport } from './benchmark'
import { ANCHOR_ISO } from '../core/clock'

/**
 * The benchmark's Node entry point — run via `npm run benchmark` (see
 * scripts/run-benchmark.mjs). Seeds the hospital, replays the naive
 * baselines, writes the committed `src/app/data/benchmark.json` the site
 * imports, and prints a human-readable table to stdout.
 *
 * `generatedAtIso` is pinned to `ANCHOR_ISO` (the seed's fixed clock
 * anchor), never wall-clock time — the report is deterministic, and a
 * `Date.now()` stamp here would make two otherwise-identical runs diverge.
 */
async function main(): Promise<void> {
  const report = await runBenchmark()
  const output = { ...report, generatedAtIso: ANCHOR_ISO }

  const here = dirname(fileURLToPath(import.meta.url))
  const outPath = join(here, '..', 'app', 'data', 'benchmark.json')
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf8')

  printTable(report)
  console.log(`\nWrote ${outPath}`)
}

function printTable(report: BenchmarkReport): void {
  console.log(`Replayed ${report.commands} commands from the seeded six-month hospital.\n`)
  console.table({
    'N1 floatMoney': report.n1,
    'N2 occupancyFlag': report.n2,
    'N3 msDates': report.n3,
    wardos: report.wardos,
  })
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
