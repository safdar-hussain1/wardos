import benchmarkJson from '../data/benchmark.json'
import summaryJson from '../data/summary.json'
import { formatINR, formatDateIST } from '../format'

interface BenchmarkN1 {
  description: string
  invoicesWrong: number
  worstErrorPaise: number
  totalAbsErrorPaise: number
}
interface BenchmarkN2 {
  description: string
  bedsDrifted: number
  wrongfulRefusals: number
  phantomFreeBeds: number
  phantomFreeAtEnd: number
  crashesInjected: number
  crashesOnAdmit: number
  crashesOnDischarge: number
}
interface BenchmarkN3 {
  description: string
  invoicesWrong: number
  nightsUnderbilled: number
  nightsOverbilled: number
  dayCasesFreed: number
}
interface BenchmarkWardos {
  invoicesWrong: number
  bedsDrifted: number
  doubleBookingsAccepted: number
  invoicesChecked: number
  bedsChecked: number
  admissionsTotal: number
}
interface Benchmark {
  commands: number
  n1: BenchmarkN1
  n2: BenchmarkN2
  n3: BenchmarkN3
  wardos: BenchmarkWardos
  generatedAtIso: string
}

interface Summary {
  generatedAtIso: string
  census: { patients: number; active: number; bedsTotal: number; bedsFree: number }
  occupancyByWard: { ward: string; bedsTotal: number; occupied: number; free: number; ratePaise: number }[]
  revenueByChargeKind: { kind: string; totalPaise: number }[]
  payrollByRole: { rows: { role: string; count: number; totalPaise: number }[]; totalPaise: number }
  outstandingPaise: number
  refundCount: number
}

const benchmark = benchmarkJson as Benchmark
const summary = summaryJson as Summary

const CLAIMS: { id: string; claim: string; enforcedBy: string; testedBy: string }[] = [
  {
    id: 'C1',
    claim: 'Double-booking a bed is structurally impossible',
    enforcedBy: 'A partial unique index on active admissions per bed, in the schema itself — not application code',
    testedBy: 'A raw SQL insert bypassing the engine, onto an already-occupied bed, must throw a constraint error',
  },
  {
    id: 'C2',
    claim: 'The event log is sufficient: replaying it reproduces the exact live state',
    enforcedBy: 'Every mutating command appends one event, in the same transaction, before it commits',
    testedBy: 'Replaying the full six-month event log into a fresh projection and comparing it, table for table, id for id, field for field, against the live database',
  },
  {
    id: 'C3',
    claim: 'Billing direction is right: an over-deposit yields a refund, never a negative charge',
    enforcedBy: 'One balance computation — room total plus extras, minus deposit — with the sign read afterward, not chosen upfront',
    testedBy: 'An invoice where the deposit exceeds the charges asserts a negative balance, labelled a refund, equal to deposit minus charges',
  },
  {
    id: 'C4',
    claim: 'Money never floats',
    enforcedBy: 'Every amount is an integer number of paise, end to end — there is no rupee-as-decimal representation anywhere in the money path',
    testedBy: 'Property tests over thousands of operations assert no drift, plus a source scan for float-money patterns in the billing path',
  },
  {
    id: 'C5',
    claim: 'Permissions are enforced in the command layer, not the interface',
    enforcedBy: 'Every command checks the actor’s role against a permission matrix before it touches the database',
    testedBy: 'A table-driven test calls every command as every role directly against the engine — bypassing every screen — and asserts access is denied exactly where the matrix says it should be',
  },
]

const NON_GOALS = [
  'This is a single-facility, single-device demo — not a multi-tenant or multi-location system.',
  'The clock is frozen at a fixed anchor instant, not the real time. Every figure on this page is dated, not live-updating against a calendar.',
  'Accounts and roles are real in structure — hashed passwords, per-command permission checks — but scoped to this local demo. They protect the integrity of this session\'s data, not a networked deployment.',
  'Storage is a browser database (IndexedDB) the browser itself may evict under storage pressure. "Reset demo" always restores a clean seeded hospital, so nothing is ever unrecoverable.',
  'Nothing here is a medical device or clinical decision support. It manages beds, bills, payroll, and dispatch — not diagnoses or treatment.',
]

const CHARGE_KIND_LABELS: Record<string, string> = {
  PROCEDURE: 'Procedures',
  PHARMACY: 'Pharmacy',
  CONSULTATION: 'Consultation',
  TRANSPORT: 'Transport',
}

/**
 * The results/about screen (nav label "Results"): what WardOS is, the five
 * structural claims from the design spec, the naive-baseline benchmark, the
 * seeded hospital's summary figures, and an honesty section. Every number
 * here is read from the two frozen, committed JSON files the benchmark and
 * summary export scripts produce (`src/app/data/benchmark.json`,
 * `src/app/data/summary.json`) — deliberately not the live engine, so this
 * page is the one place in the app that stays identical no matter what a
 * visitor does elsewhere in the demo. (The command deck is the live-db
 * counterpart — see CommandDeck.tsx.)
 */
export default function About() {
  return (
    <section className="about-page">
      <section className="about-intro">
        <h2>What WardOS is</h2>
        <p>
          WardOS is a hospital operations system that runs entirely in your browser. Beds, admissions,
          billing, payroll, ambulance dispatch, role-based access, and a complete audit history, all backed
          by a real SQLite database that lives on your device. This site is not a demo of the product — it
          is the product, seeded with a deterministic six-month hospital so you can use every feature within
          seconds of the page loading.
        </p>
        <p>
          Every screen reads and writes through one engine, the same engine the command-line tool and the
          test suite both run against. The interface itself carries no billing math, no permission rules, no
          double-booking logic — it renders what the engine reports and issues the commands the engine
          accepts. A rule that only exists in a screen would be a bug.
        </p>
        <p>
          Nothing you do here leaves your device. There is no server behind this site after the page loads —
          patient records, bills, and payroll figures stay local, verifiably: the production build is scanned
          for any absolute-origin network call, and shipping one would fail that scan.
        </p>
      </section>

      <section className="about-claims">
        <h2>Five structural claims</h2>
        <p>Each of these is enforced in the engine and has a test that fails if the enforcement is removed.</p>
        <div className="table-scroll">
          <table className="claims-table">
            <thead>
              <tr>
                <th>Claim</th>
                <th>How it&apos;s enforced</th>
                <th>How it&apos;s tested</th>
              </tr>
            </thead>
            <tbody>
              {CLAIMS.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.id}.</strong> {c.claim}
                  </td>
                  <td>{c.enforcedBy}</td>
                  <td>{c.testedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="about-benchmark">
        <h2>The benchmark</h2>
        <p>
          The same {benchmark.commands.toLocaleString('en-IN')}-command, six-month history that seeds this
          demo was also run through three faithful reimplementations of the classic ways hospital
          back-offices go wrong — float money, a hand-maintained occupancy flag, and millisecond date math.
          Below are the real numbers each one produces, and WardOS&apos;s own result on the identical
          history.
        </p>

        <div className="benchmark-grid">
        <article className="benchmark-baseline">
          <h3>N1 &mdash; float money</h3>
          <p>{benchmark.n1.description}</p>
          <div className="table-scroll">
            <table className="benchmark-table">
              <tbody>
                <tr>
                  <th>Invoices wrong</th>
                  <td>{benchmark.n1.invoicesWrong}</td>
                </tr>
                <tr>
                  <th>Worst single error</th>
                  <td>{formatINR(benchmark.n1.worstErrorPaise)}</td>
                </tr>
                <tr>
                  <th>Total misbilled</th>
                  <td>{formatINR(benchmark.n1.totalAbsErrorPaise)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <article className="benchmark-baseline">
          <h3>N2 &mdash; hand-maintained occupancy flag</h3>
          <p>{benchmark.n2.description}</p>
          <div className="table-scroll">
            <table className="benchmark-table">
              <tbody>
                <tr>
                  <th>Beds still drifted at the end</th>
                  <td>{benchmark.n2.bedsDrifted}</td>
                </tr>
                <tr>
                  <th>Wrongful refusals of a free bed</th>
                  <td>{benchmark.n2.wrongfulRefusals}</td>
                </tr>
                <tr>
                  <th>Phantom-free beds (double-booking hazard)</th>
                  <td>{benchmark.n2.phantomFreeBeds}</td>
                </tr>
                <tr>
                  <th>Phantom-free beds still unresolved at the end</th>
                  <td>{benchmark.n2.phantomFreeAtEnd}</td>
                </tr>
                <tr>
                  <th>Crashes injected (on admit / on discharge)</th>
                  <td>
                    {benchmark.n2.crashesInjected} ({benchmark.n2.crashesOnAdmit} / {benchmark.n2.crashesOnDischarge})
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <article className="benchmark-baseline">
          <h3>N3 &mdash; millisecond date math</h3>
          <p>{benchmark.n3.description}</p>
          <div className="table-scroll">
            <table className="benchmark-table">
              <tbody>
                <tr>
                  <th>Invoices wrong</th>
                  <td>{benchmark.n3.invoicesWrong}</td>
                </tr>
                <tr>
                  <th>Nights underbilled</th>
                  <td>{benchmark.n3.nightsUnderbilled}</td>
                </tr>
                <tr>
                  <th>Nights overbilled</th>
                  <td>{benchmark.n3.nightsOverbilled}</td>
                </tr>
                <tr>
                  <th>Day cases wrongly freed (0 nights billed)</th>
                  <td>{benchmark.n3.dayCasesFreed}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
        </div>

        <article className="benchmark-baseline benchmark-baseline--wardos">
          <h3>WardOS &mdash; on the identical history</h3>
          <div className="table-scroll">
            <table className="benchmark-table">
              <tbody>
                <tr>
                  <th>Invoices wrong</th>
                  <td>
                    {benchmark.wardos.invoicesWrong} <span className="checked-of">of {benchmark.wardos.invoicesChecked} checked</span>
                  </td>
                </tr>
                <tr>
                  <th>Beds drifted</th>
                  <td>
                    {benchmark.wardos.bedsDrifted} <span className="checked-of">of {benchmark.wardos.bedsChecked} checked</span>
                  </td>
                </tr>
                <tr>
                  <th>Double-bookings accepted</th>
                  <td>
                    {benchmark.wardos.doubleBookingsAccepted}{' '}
                    <span className="checked-of">across {benchmark.wardos.admissionsTotal} admissions</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="about-summary">
        <h2>The seeded hospital, as of {formatDateIST(summary.generatedAtIso)}</h2>

        <div className="table-scroll">
          <table className="summary-table">
            <tbody>
              <tr>
                <th>Patients</th>
                <td>{summary.census.patients}</td>
              </tr>
              <tr>
                <th>Active admissions</th>
                <td>{summary.census.active}</td>
              </tr>
              <tr>
                <th>Beds</th>
                <td>
                  {summary.census.bedsFree} free of {summary.census.bedsTotal}
                </td>
              </tr>
              <tr>
                <th>Outstanding balance</th>
                <td>{formatINR(summary.outstandingPaise)}</td>
              </tr>
              <tr>
                <th>Refunds issued</th>
                <td>{summary.refundCount}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>Occupancy by ward</h3>
        <div className="table-scroll">
          <table className="summary-table">
            <thead>
              <tr>
                <th>Ward</th>
                <th>Rate/night</th>
                <th>Occupied</th>
                <th>Free</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {summary.occupancyByWard.map((w) => (
                <tr key={w.ward}>
                  <td>{w.ward}</td>
                  <td>{formatINR(w.ratePaise)}</td>
                  <td>{w.occupied}</td>
                  <td>{w.free}</td>
                  <td>{w.bedsTotal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3>Revenue by kind</h3>
        <div className="table-scroll">
          <table className="summary-table">
            <tbody>
              {summary.revenueByChargeKind.map((r) => (
                <tr key={r.kind}>
                  <th>{CHARGE_KIND_LABELS[r.kind] ?? r.kind}</th>
                  <td>{formatINR(r.totalPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3>Payroll by role</h3>
        <div className="table-scroll">
          <table className="summary-table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Headcount</th>
                <th>Monthly total</th>
              </tr>
            </thead>
            <tbody>
              {summary.payrollByRole.rows.map((r) => (
                <tr key={r.role}>
                  <td>{r.role}</td>
                  <td>{r.count}</td>
                  <td>{formatINR(r.totalPaise)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="payroll-total-row">
                <td colSpan={2}>Payroll total</td>
                <td>{formatINR(summary.payrollByRole.totalPaise)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="about-honesty">
        <h2>Non-goals and honesty notes</h2>
        <ul>
          {NON_GOALS.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ul>
      </section>
    </section>
  )
}
