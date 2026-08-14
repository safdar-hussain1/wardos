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

  // `description` is a paragraph, not a table cell — print it separately
  // per baseline, then a numbers-only table for the metrics themselves.
  const { description: n1Description, ...n1Metrics } = report.n1
  const { description: n2Description, ...n2Metrics } = report.n2
  const { description: n3Description, ...n3Metrics } = report.n3

  console.log(`N1 floatMoney — ${n1Description}\n`)
  console.log(`N2 occupancyFlag — ${n2Description}\n`)
  console.log(`N3 msDates — ${n3Description}\n`)

  console.table({
    'N1 floatMoney': n1Metrics,
    'N2 occupancyFlag': n2Metrics,
    'N3 msDates': n3Metrics,
    wardos: report.wardos,
  })
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
