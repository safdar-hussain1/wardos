import { useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { planLayout } from './layout'
import type { BedBox, PlanLayout, Variant, WardKey } from './layout'
import { WARD_LABELS, WARD_TOKENS } from '../labels'
import { formatDateIST } from '../format'

export interface PlanBed {
  id: number
  label: string
  ward: string
  occupied: boolean
  patientName?: string
  admittedAt?: string
  nights?: number
}

export interface PlanAmbulance {
  id: number
  plate: string
  /** Where it is, when it is out on a call. */
  outTo?: string
}

/** "Vidya Bose" -> "VB": first letters of the first and last name. */
export function initials(name: string | undefined): string {
  if (!name) return ''
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  const first = parts[0][0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : ''
  return (first + last).toUpperCase()
}

function bedSentence(bed: PlanBed, interactive: boolean): string {
  const where = `Bed ${bed.label}, ${WARD_LABELS[bed.ward] ?? bed.ward}`
  if (!bed.occupied) return interactive ? `${where}. Free. Admit a patient here.` : `${where}. Free.`
  const who = bed.patientName ?? 'occupied'
  return interactive ? `${where}. ${who}. Open the chart.` : `${where}. ${who}.`
}

function linePath(points: [number, number][]): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')
}

function doorPath(d: { x: number; y: number; r: number; sx: 1 | -1; sy: 1 | -1 }): string {
  // the leaf (hinge to the swung-open end) and the quarter-circle it sweeps
  const openX = d.x
  const openY = d.y + d.sy * d.r
  const closedX = d.x + d.sx * d.r
  const closedY = d.y
  const sweep = d.sx * d.sy > 0 ? 1 : 0
  return `M ${d.x} ${d.y} L ${openX} ${openY} A ${d.r} ${d.r} 0 0 ${sweep} ${closedX} ${closedY}`
}

function Bed({
  box,
  bed,
  interactive,
  selected,
  index,
  onSelect,
  onHover,
}: {
  box: BedBox
  bed: PlanBed
  interactive: boolean
  selected: boolean
  index: number
  onSelect: (bed: PlanBed) => void
  onHover: (id: number | null) => void
}) {
  const { x, y, w, h, head } = box
  const pillowH = Math.round(h * 0.2)
  const pillowY = head === 'top' ? 5 : h - 5 - pillowH
  // the blanket covers the bed from the pillow to the foot
  const blanketY = head === 'top' ? pillowY + pillowH + 3 : 4
  const blanketH = head === 'top' ? h - blanketY - 4 : pillowY - 3 - 4
  const headCy = pillowY + pillowH / 2
  const plateY = head === 'top' ? h + 13 : -6
  const token = WARD_TOKENS[box.ward] ?? 'general'

  function onKeyDown(e: KeyboardEvent<SVGGElement>): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect(bed)
    }
  }

  const state = `bed--${token} ${bed.occupied ? 'bed--occupied' : 'bed--free'} bed--head-${head}${selected ? ' bed--selected' : ''}`

  // The initials sit beside the button rather than inside it: a speech-input
  // user says what the control shows ("G-01"), and the full name is in the
  // accessible label already.
  return (
    <g className="bedwrap" transform={`translate(${x} ${y})`} style={{ ['--i' as string]: index }}>
      <g
        className={`bed ${state}`}
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-label={interactive ? bedSentence(bed, true) : undefined}
        aria-pressed={interactive ? selected : undefined}
        onClick={interactive ? () => onSelect(bed) : undefined}
        onKeyDown={interactive ? onKeyDown : undefined}
        onPointerEnter={() => onHover(bed.id)}
        onPointerLeave={() => onHover(null)}
        onFocus={() => onHover(bed.id)}
        onBlur={() => onHover(null)}
        data-bed={bed.label}
      >
        <g className="bed__lift">
          <rect className="bed__ring" x={-5} y={-5} width={w + 10} height={h + 10} rx={10} />
          <rect className="bed__frame" width={w} height={h} rx={6} />
          <rect className="bed__pillow" x={5} y={pillowY} width={w - 10} height={pillowH} rx={4} />
          <rect className="bed__blanket" x={3} y={blanketY} width={w - 6} height={blanketH} rx={4} />
          <circle className="bed__head" cx={w / 2} cy={headCy} r={Math.min(7, pillowH / 2 + 1)} />
          <path
            className="bed__plus"
            d={`M ${w / 2 - 6} ${blanketY + blanketH / 2} h 12 M ${w / 2} ${blanketY + blanketH / 2 - 6} v 12`}
          />
          <text className="bed__label" x={w / 2} y={plateY} textAnchor="middle">
            {box.label}
          </text>
        </g>
      </g>
      <text
        className={`bed__initials ${state}`}
        x={w / 2}
        y={blanketY + blanketH / 2 + 4.5}
        textAnchor="middle"
        aria-hidden="true"
      >
        {initials(bed.patientName)}
      </text>
    </g>
  )
}

function Ambulance({
  slot,
  ambulance,
  onSelect,
}: {
  slot: { x: number; y: number; w: number; h: number }
  ambulance: PlanAmbulance | undefined
  onSelect?: (id: number) => void
}) {
  const out = ambulance?.outTo !== undefined
  const unit = ambulance ? ambulance.plate.replace('WD-AMB-', 'Unit ') : ''
  // the spoken name starts with the words drawn on the plan ("Unit 02", "Out")
  const label = ambulance
    ? out
      ? `Out: ambulance ${ambulance.plate} is on a call at ${ambulance.outTo}.`
      : `${unit}: ambulance ${ambulance.plate}, on station.`
    : 'Empty bay'
  const clickable = ambulance !== undefined && onSelect !== undefined
  const vw = 64
  const vh = 30
  const vx = slot.x + (slot.w - vw) / 2
  const vy = slot.y + 8
  return (
    <g className={`ambwrap${out ? ' ambwrap--out' : ''}`}>
      <g
        className={`amb ${out ? 'amb--out' : 'amb--in'}`}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        aria-label={clickable ? `${label} Open the ambulance board.` : undefined}
        onClick={clickable ? () => onSelect(ambulance.id) : undefined}
        onKeyDown={
          clickable
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(ambulance.id)
                }
              }
            : undefined
        }
      >
        <rect className="amb__slot" x={slot.x} y={slot.y} width={slot.w} height={slot.h} rx={6} />
        {out ? (
          <>
            <rect className="amb__ghost" x={vx} y={vy} width={vw} height={vh} rx={7} />
            <text className="amb__out" x={slot.x + slot.w / 2} y={vy + vh / 2 + 4} textAnchor="middle">
              Out
            </text>
          </>
        ) : (
          <>
            <g className="amb__van">
              <rect className="amb__body" x={vx} y={vy} width={vw} height={vh} rx={7} />
              <rect className="amb__cab" x={vx + vw - 16} y={vy + 3} width={12} height={vh - 6} rx={3} />
              <rect className="amb__bar" x={vx + vw - 22} y={vy + 6} width={3} height={vh - 12} rx={1.5} />
              <path
                className="amb__cross"
                d={`M ${vx + 20} ${vy + vh / 2 - 7} h 6 v 4 h 4 v 6 h -4 v 4 h -6 v -4 h -4 v -6 h 4 z`}
              />
            </g>
            <text className="amb__plate" x={slot.x + slot.w / 2} y={slot.y + slot.h - 8} textAnchor="middle">
              {unit}
            </text>
          </>
        )}
      </g>
      {out && (
        // where it went, beside the control (its name is "Out"; the place is in its label)
        <text className="amb__plate amb__plate--out" x={slot.x + slot.w / 2} y={slot.y + slot.h - 8} textAnchor="middle" aria-hidden="true">
          {ambulance?.outTo}
        </text>
      )}
    </g>
  )
}

export default function FloorPlan({
  beds,
  ambulances,
  variant,
  interactive,
  selectedBedId,
  onSelectBed,
  onSelectAmbulance,
  label,
}: {
  beds: PlanBed[]
  ambulances: PlanAmbulance[]
  variant: Variant
  interactive: boolean
  selectedBedId: number | null
  onSelectBed: (bed: PlanBed) => void
  onSelectAmbulance?: (id: number) => void
  /** What the plan shows, for screen readers ("The hospital today: 17 of 32 beds in use"). */
  label: string
}) {
  // Cheap enough (a few loops over 32 beds) to work out on every render.
  const layout: PlanLayout = planLayout(beds, variant)
  const bedById = useMemo(() => new Map(beds.map((b) => [b.id, b])), [beds])
  const [hoverId, setHoverId] = useState<number | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const hovered = hoverId === null ? undefined : layout.beds.find((b) => b.id === hoverId)
  const hoveredBed = hoverId === null ? undefined : bedById.get(hoverId)

  return (
    <div className={`plan plan--${variant}${interactive ? ' plan--live' : ' plan--history'}`} ref={wrapRef}>
      <svg
        className="plan__svg"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="group"
        aria-label={label}
      >
        <defs>
          <pattern id={`hatch-${variant}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" className="plan__hatch" />
          </pattern>
        </defs>

        <rect className="plan__site" x={0} y={0} width={layout.width} height={layout.height} />
        <rect
          className="plan__floor"
          x={layout.building.x}
          y={layout.building.y}
          width={layout.building.w}
          height={layout.building.h}
        />
        {layout.zones.map((z) => (
          <rect key={z.ward} className={`plan__zone plan__zone--${WARD_TOKENS[z.ward]}`} x={z.x} y={z.y} width={z.w} height={z.h} />
        ))}
        {layout.corridors.map((c, i) => (
          <rect key={i} className="plan__corridor" x={c.x} y={c.y} width={c.w} height={c.h} />
        ))}

        <g className="plan__lines" aria-hidden="true">
          {layout.lines.map((line, i) => (
            <g key={line.ward} className={`floorline floorline--${WARD_TOKENS[line.ward]}`} style={{ ['--i' as string]: i }}>
              <path className="floorline__path" d={linePath(line.points)} pathLength={1} />
              <circle
                className="floorline__end"
                cx={line.points[line.points.length - 1][0]}
                cy={line.points[line.points.length - 1][1]}
                r={5}
              />
            </g>
          ))}
        </g>

        <g className="plan__fixtures" aria-hidden="true">
          {layout.fixtures.map((f, i) => (
            <path key={i} className={`fixture fixture--${f.kind}`} d={f.d} />
          ))}
          {layout.curtains.map(([x1, y1, x2, y2], i) => (
            <line key={i} className="plan__curtain" x1={x1} y1={y1} x2={x2} y2={y2} />
          ))}
          {layout.glass.map(([x1, y1, x2, y2], i) => (
            <line key={i} className="plan__glass" x1={x1} y1={y1} x2={x2} y2={y2} />
          ))}
          {layout.doors.map((d, i) => (
            <path key={i} className="plan__door" d={doorPath(d)} />
          ))}
        </g>

        <g className="plan__walls" aria-hidden="true">
          {layout.walls.map(([x1, y1, x2, y2], i) => (
            <line key={i} className="plan__wall" x1={x1} y1={y1} x2={x2} y2={y2} />
          ))}
          {layout.outerWalls.map(([x1, y1, x2, y2], i) => (
            <line key={i} className="plan__wall plan__wall--outer" x1={x1} y1={y1} x2={x2} y2={y2} />
          ))}
        </g>

        <g className="plan__plates" aria-hidden="true">
          {layout.plates.map((p) => (
            <g key={p.ward} className={`plate plate--${WARD_TOKENS[p.ward]}`} transform={`translate(${p.x} ${p.y})`}>
              <rect className="plate__bg" width={p.w} height={p.h} rx={5} />
              <circle className="plate__dot" cx={13} cy={p.h / 2} r={4.5} />
              <text className="plate__text" x={24} y={p.h / 2 + 4.2}>
                {p.text}
              </text>
            </g>
          ))}
          {layout.labels.map((l, i) => (
            <text key={i} className={`plan__label plan__label--${l.tone}`} x={l.x} y={l.y} textAnchor={l.anchor}>
              {l.text}
            </text>
          ))}
        </g>

        <g className="plan__beds">
          {layout.beds.map((box, i) => {
            const bed = bedById.get(box.id)
            if (!bed) return null
            return (
              <Bed
                key={box.id}
                box={box}
                bed={bed}
                index={i}
                interactive={interactive}
                selected={selectedBedId === box.id}
                onSelect={onSelectBed}
                onHover={setHoverId}
              />
            )
          })}
        </g>

        <g className="plan__bay">
          <rect
            className="plan__bay-apron"
            x={layout.ambulanceBay.x}
            y={layout.ambulanceBay.y}
            width={layout.ambulanceBay.w}
            height={layout.ambulanceBay.h}
            rx={10}
            fill={`url(#hatch-${variant})`}
          />
          {layout.ambulanceSlots.map((slot) => (
            <Ambulance
              key={slot.index}
              slot={slot}
              ambulance={ambulances[slot.index]}
              onSelect={interactive ? onSelectAmbulance : undefined}
            />
          ))}
        </g>
      </svg>

      {hovered && hoveredBed && <BedTip box={hovered} bed={hoveredBed} layout={layout} interactive={interactive} />}
    </div>
  )
}

function BedTip({
  box,
  bed,
  layout,
  interactive,
}: {
  box: BedBox
  bed: PlanBed
  layout: PlanLayout
  interactive: boolean
}) {
  // Positioned in percentages of the drawing, so it tracks the bed at any rendered size.
  const left = ((box.x + box.w / 2) / layout.width) * 100
  const below = box.head === 'top' && box.y < layout.height * 0.3
  const top = ((below ? box.y + box.h + 22 : box.y - 10) / layout.height) * 100
  const ward = box.ward as WardKey
  return (
    <div
      className={`bedtip bedtip--${WARD_TOKENS[ward]}${below ? ' bedtip--below' : ''}`}
      style={{ left: `${left}%`, top: `${top}%` }}
      aria-hidden="true"
    >
      <p className="bedtip__where">
        <span className="bedtip__swatch" />
        Bed {bed.label}, {WARD_LABELS[bed.ward] ?? bed.ward}
      </p>
      {bed.occupied ? (
        <>
          <p className="bedtip__who">{bed.patientName ?? 'Occupied'}</p>
          {bed.admittedAt !== undefined && (
            <p className="bedtip__meta">
              In since {formatDateIST(bed.admittedAt)}
              {bed.nights !== undefined ? `, ${bed.nights} night${bed.nights === 1 ? '' : 's'} so far` : ''}
            </p>
          )}
        </>
      ) : (
        <p className="bedtip__who bedtip__who--free">Free</p>
      )}
      {interactive && <p className="bedtip__hint">{bed.occupied ? 'Click to open the chart' : 'Click to admit someone'}</p>}
      {!interactive && <p className="bedtip__hint">Replayed from the event log</p>}
    </div>
  )
}
