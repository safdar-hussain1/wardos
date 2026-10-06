import benchmarkJson from '../data/benchmark.json'
import { formatINR } from '../format'

interface Benchmark {
  commands: number
  n1: { invoicesWrong: number; worstErrorPaise: number }
  n2: { phantomFreeBeds: number; wrongfulRefusals: number; crashesInjected: number }
  n3: { invoicesWrong: number }
  wardos: { invoicesWrong: number; invoicesChecked: number; bedsDrifted: number; bedsChecked: number }
}

const benchmark = benchmarkJson as Benchmark

const COLUMNS = 29

/** One discharged bill per square; the wrong ones are filled. */
function Units({ total, wrong, label }: { total: number; wrong: number; label: string }) {
  const size = 9
  const gap = 3
  const rows = Math.ceil(total / COLUMNS)
  const w = COLUMNS * (size + gap) - gap
  const h = rows * (size + gap) - gap
  return (
    <svg className="units" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      {Array.from({ length: total }, (_, i) => {
        const x = (i % COLUMNS) * (size + gap)
        const y = Math.floor(i / COLUMNS) * (size + gap)
        return (
          <rect
            key={i}
            className={i < wrong ? 'units__wrong' : 'units__right'}
            x={x + (i < wrong ? 0 : 0.75)}
            y={y + (i < wrong ? 0 : 0.75)}
            width={i < wrong ? size : size - 1.5}
            height={i < wrong ? size : size - 1.5}
            rx={2}
          />
        )
      })}
    </svg>
  )
}

/**
 * The one figure on the page: the same six-month history billed three ways.
 * Every number is read from benchmark.json, the committed output of
 * `npm run benchmark`; nothing here is typed in by hand.
 */
export default function Proof() {
  const total = benchmark.wardos.invoicesChecked
  const rows = [
    {
      key: 'float',
      name: 'Float money',
      how: 'Rupees kept as decimal numbers, adjusted on a running total.',
      wrong: benchmark.n1.invoicesWrong,
      note: `Worst bill off by ${formatINR(benchmark.n1.worstErrorPaise)}.`,
    },
    {
      key: 'ms',
      name: 'Millisecond date maths',
      how: 'Nights counted as hours divided by 24, rounded.',
      wrong: benchmark.n3.invoicesWrong,
      note: 'Short stays rounded down to zero nights.',
    },
    {
      key: 'wardos',
      name: 'WardOS',
      how: 'Whole paise, and nights counted on the Indian calendar day.',
      wrong: benchmark.wardos.invoicesWrong,
      note: 'Every bill matches the independent check.',
    },
  ]

  return (
    <section className="proof" aria-labelledby="proof-title">
      <div className="section-head">
        <h2 id="proof-title">The same six months, billed three ways</h2>
        <p>
          The hospital’s {benchmark.commands.toLocaleString('en-IN')} recorded actions were run through two common shortcuts in
          billing software, and through WardOS. Each square is one discharged bill, checked against an
          independent calculation.
        </p>
      </div>

      <div className="proof__rows">
        {rows.map((r) => (
          <div key={r.key} className={`proof__row proof__row--${r.key}`}>
            <div className="proof__name">
              <h3>{r.name}</h3>
              <p>{r.how}</p>
            </div>
            <Units total={total} wrong={r.wrong} label={`${r.name}: ${r.wrong} of ${total} bills wrong`} />
            <div className="proof__count">
              <p>
                <strong>{r.wrong}</strong> of {total} bills wrong
              </p>
              <p className="proof__note">{r.note}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="proof__foot">
        <p className="proof__legend" aria-hidden="true">
          <span className="units-key units-key--wrong" /> Wrong bill
          <span className="units-key units-key--right" /> Correct bill
        </p>
        <p>
          Beds too: a separate “occupied” flag that loses a write now and then ({benchmark.n2.crashesInjected} lost
          writes over the six months) showed a full bed as free {benchmark.n2.phantomFreeBeds} times. WardOS reads a
          bed’s state from the admission itself, so there is no second record to fall out of step:{' '}
          {benchmark.wardos.bedsDrifted} of {benchmark.wardos.bedsChecked} beds drifted.
        </p>
        <p>
          <a href="#measurements">See every measurement and how each was taken</a>
        </p>
      </div>
    </section>
  )
}
