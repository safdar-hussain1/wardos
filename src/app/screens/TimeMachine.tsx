import { useEffect, useMemo, useRef, useState } from 'react'
import type { Engine } from '../../core/engine'
import type { BedRow } from '../../core/replay'
import type { EventRow } from '../../core/events'
import { ANCHOR_ISO } from '../../core/clock'
import { WARD_ORDER, timeMachineVm } from '../viewmodels'
import { formatINR, formatDateIST } from '../format'
import { WARD_LABELS } from './wardLabels'

const DAY_MS = 86_400_000
const PLAY_INTERVAL_MS = 150

/**
 * Fetched once, on mount, from the live engine — the screen's *only* db
 * access. Every scrub afterward calls `timeMachineVm(events, beds,
 * uptoIso)`, a pure fold over these two arrays (see viewmodels.ts's doc
 * comment and tests/app-logic.test.ts's poisoned-Db-facade test), so
 * dragging the slider or hitting play never touches the database again.
 */
function useFetchedOnce(engine: Engine): { events: EventRow[]; beds: BedRow[] } {
  const [data] = useState(() => ({
    events: engine.eventsLog(),
    beds: engine.beds().map((b) => ({ id: b.id, label: b.label, ward: b.ward, ratePaise: b.ratePaise })),
  }))
  return data
}

export default function TimeMachine({ engine }: { engine: Engine }) {
  const { events, beds } = useFetchedOnce(engine)
  const [isPlaying, setIsPlaying] = useState(false)

  // The scrub range's two ends: the earliest event in this session's
  // history, and ANCHOR_ISO — the frozen "now" every screen in the app
  // otherwise shows. Derived from the fetched data itself, not a
  // hand-copied constant, so the range is always exactly as wide as the
  // history actually is (including anything the current demo session has
  // added since the seed).
  const startIso = useMemo(
    () => events.reduce<string | undefined>((min, e) => (min === undefined || e.at < min ? e.at : min), undefined) ?? ANCHOR_ISO,
    [events],
  )
  const totalDays = useMemo(
    () => Math.max(0, Math.round((Date.parse(ANCHOR_ISO) - Date.parse(startIso)) / DAY_MS)),
    [startIso],
  )
  const [dayIndex, setDayIndex] = useState(totalDays)

  const uptoIso = dayIndex >= totalDays ? ANCHOR_ISO : new Date(Date.parse(startIso) + dayIndex * DAY_MS).toISOString()

  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  useEffect(() => {
    if (!isPlaying) return
    intervalRef.current = setInterval(() => {
      setDayIndex((d) => {
        if (d >= totalDays) {
          setIsPlaying(false)
          return d
        }
        return d + 1
      })
    }, PLAY_INTERVAL_MS)
    return () => clearInterval(intervalRef.current)
  }, [isPlaying, totalDays])

  // Pure projection — see useFetchedOnce's doc comment. No engine/db call here.
  const vm = timeMachineVm(events, beds, uptoIso)

  const bedsByWard = WARD_ORDER.map((ward) => ({ ward, beds: vm.beds.filter((b) => b.ward === ward) }))

  function handlePlayToggle(): void {
    if (!isPlaying && dayIndex >= totalDays) setDayIndex(0)
    setIsPlaying((p) => !p)
  }

  return (
    <section className="time-machine">
      <div className="scrubber">
        <button type="button" className="scrubber-play" onClick={handlePlayToggle} aria-pressed={isPlaying}>
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          min={0}
          max={totalDays}
          step={1}
          value={dayIndex}
          onChange={(e) => {
            setIsPlaying(false)
            setDayIndex(Number(e.target.value))
          }}
          aria-label="Scrub date"
          className="scrubber-range"
        />
        <span className="scrubber-date">{formatDateIST(uptoIso)}</span>
      </div>

      <div className="stat-tiles">
        <div className="stat-tile">
          <span className="stat-tile__label">Patients registered</span>
          <span className="stat-tile__value">{vm.patients}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile__label">Active admissions</span>
          <span className="stat-tile__value">{vm.activeAdmissions}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile__label">Beds free</span>
          <span className="stat-tile__value">
            {vm.bedsFree}
            <span className="stat-tile__value-of">/{vm.bedsTotal}</span>
          </span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile__label">Revenue to date</span>
          <span className="stat-tile__value stat-tile__value--money">{formatINR(vm.revenueToDatePaise)}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile__label">Refunds to date</span>
          <span className="stat-tile__value">{vm.refundsToDate}</span>
        </div>
      </div>

      <section className="deck-section" aria-label="Ward board at the scrubbed instant">
        <h2>Ward board at this instant</h2>
        {bedsByWard.map((group) => (
          <div key={group.ward} className="ward-group ward-group--mini">
            <h3>
              <span className="ward-code" aria-hidden="true">
                {group.ward.charAt(0)}
              </span>
              {WARD_LABELS[group.ward] ?? group.ward}
              <span className="ward-counts">
                <strong>{group.beds.filter((b) => !b.occupied).length}</strong> free ·{' '}
                <strong>{group.beds.filter((b) => b.occupied).length}</strong> occupied
              </span>
            </h3>
            <div className="bed-row bed-row--mini">
              {group.beds.map((bed) => (
                <span
                  key={bed.id}
                  className={`bed-cell bed-cell--mini ${bed.occupied ? 'bed-cell--occupied' : 'bed-cell--free'}`}
                  title={bed.label}
                >
                  {bed.label}
                </span>
              ))}
            </div>
          </div>
        ))}
      </section>
    </section>
  )
}
