import { useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { useElementWidth } from '../hooks'
import { formatDateIST } from '../format'
import { Icon } from '../icons'

export interface TimelinePoint {
  iso: string
  occupied: number
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const IST_MS = 5.5 * 3600_000

function istParts(iso: string): { day: number; month: number } {
  const d = new Date(Date.parse(iso) + IST_MS)
  return { day: d.getUTCDate(), month: d.getUTCMonth() }
}

/** A clean axis maximum at or above the data: 17 -> 20, 8 -> 10. */
function niceMax(v: number): number {
  if (v <= 5) return 5
  if (v <= 10) return 10
  return Math.ceil(v / 10) * 10
}

/**
 * The time machine: beds in use each morning across the whole history,
 * drawn as an area chart that is also the slider. Dragging, clicking or the
 * arrow keys move through the days; the floor plan above follows. A real
 * range input sits on top of the drawing, so keyboard and screen-reader
 * access come from the browser itself.
 */
export default function Timeline({
  points,
  index,
  onScrub,
  playing,
  onTogglePlay,
  bedsTotal,
}: {
  points: TimelinePoint[]
  index: number
  onScrub: (index: number) => void
  playing: boolean
  onTogglePlay: () => void
  bedsTotal: number
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const width = useElementWidth(wrapRef)
  const [hover, setHover] = useState<number | null>(null)

  const n = points.length
  const last = n - 1
  const H = 104
  const padL = 34
  const padR = 52
  const padT = 14
  const padB = 22
  const W = Math.max(width, 280)
  const plotW = W - padL - padR
  const maxV = niceMax(Math.max(1, ...points.map((p) => p.occupied)))
  const x = (i: number) => padL + (last <= 0 ? 0 : (i / last) * plotW)
  const y = (v: number) => padT + (1 - v / maxV) * (H - padT - padB)

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.occupied).toFixed(1)}`).join(' ')
  const area = n > 0 ? `${line} L ${x(last).toFixed(1)} ${y(0)} L ${x(0).toFixed(1)} ${y(0)} Z` : ''

  // first morning of each month, for the axis
  const monthTicks: { i: number; label: string }[] = []
  let prevMonth = -1
  points.forEach((p, i) => {
    const { day, month } = istParts(p.iso)
    if (month !== prevMonth && (day <= 3 || i === 0)) {
      monthTicks.push({ i, label: MONTHS[month] })
    }
    prevMonth = month
  })

  const current = points[Math.min(Math.max(index, 0), last)]
  const atNow = index >= last
  const hoverPoint = hover === null ? undefined : points[hover]

  function indexFromPointer(e: PointerEvent<HTMLElement>): number {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left - 12 // the input starts half a thumb before the plot
    const f = Math.min(1, Math.max(0, px / plotW))
    return Math.round(f * last)
  }

  const valueText = current
    ? `${formatDateIST(current.iso)}: ${current.occupied} of ${bedsTotal} beds in use${atNow ? ', today' : ''}`
    : ''

  return (
    <div className="timeline">
      <div className="timeline__bar">
        <button
          type="button"
          className="timeline__play"
          onClick={onTogglePlay}
          aria-label={playing ? 'Pause the replay' : 'Replay six months'}
        >
          <Icon name={playing ? 'pause' : 'play'} size={18} />
        </button>
        <div className="timeline__title">
          <p className="timeline__name">Time machine</p>
          <p className="timeline__help">Beds in use each morning. Drag along the chart to rewind the hospital.</p>
        </div>
        {!atNow && (
          <button type="button" className="timeline__now" onClick={() => onScrub(last)}>
            Back to today
          </button>
        )}
      </div>

      <div className="timeline__chart" ref={wrapRef}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          {[0, maxV / 2, maxV].map((v) => (
            <g key={v}>
              <line className="timeline__grid" x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} />
              <text className="timeline__tick" x={padL - 8} y={y(v) + 4} textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          {monthTicks.map((t) => (
            <text key={t.i} className="timeline__tick" x={x(t.i)} y={H - 4} textAnchor="middle">
              {t.label}
            </text>
          ))}
          <path className="timeline__area" d={area} />
          <path className="timeline__line" d={line} />
          {n > 0 && (
            <>
              <circle className="timeline__end" cx={x(last)} cy={y(points[last].occupied)} r={4} />
              <text className="timeline__endlabel" x={x(last) + 9} y={y(points[last].occupied) + 4}>
                {points[last].occupied} today
              </text>
            </>
          )}
          {hoverPoint && hover !== null && hover !== index && (
            <line className="timeline__ghost" x1={x(hover)} x2={x(hover)} y1={padT - 6} y2={H - padB} />
          )}
          {current && (
            <g className={`timeline__head${atNow ? ' timeline__head--now' : ''}`}>
              <line x1={x(index)} x2={x(index)} y1={padT - 8} y2={H - padB} />
              <circle cx={x(index)} cy={y(current.occupied)} r={5.5} />
            </g>
          )}
        </svg>
        <input
          className="timeline__range"
          type="range"
          min={0}
          max={Math.max(0, last)}
          step={1}
          value={Math.min(index, last)}
          style={{ left: padL - 12, width: plotW + 24 }}
          aria-label="Rewind the hospital: pick a morning"
          aria-valuetext={valueText}
          onChange={(e) => onScrub(Number(e.target.value))}
          onPointerMove={(e) => setHover(indexFromPointer(e))}
          onPointerLeave={() => setHover(null)}
        />
        {hoverPoint && hover !== null && (
          <div
            className="timeline__tip"
            style={{ left: Math.min(Math.max(x(hover), 70), W - 70), top: 0 }}
            aria-hidden="true"
          >
            <strong>{hoverPoint.occupied}</strong> beds, {formatDateIST(hoverPoint.iso)}
          </div>
        )}
      </div>
    </div>
  )
}
