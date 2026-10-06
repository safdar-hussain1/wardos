import { useEffect, useMemo, useRef, useState } from 'react'
import type { Engine, Actor, BedView } from '../../core/engine'
import type { ComputedInvoice } from '../../core/billing'
import { nightsBetween } from '../../core/billing'
import { ANCHOR_ISO } from '../../core/clock'
import { describeEvent, eventNamesFrom, historyFrames } from '../viewmodels'
import type { HistoryFrame } from '../viewmodels'
import { formatDateIST, formatDateTimeIST } from '../format'
import { WARD_LABELS, WARD_TOKENS } from '../labels'
import { useElementWidth, usePrefersReducedMotion, navigateTo } from '../hooks'
import FloorPlan from '../plan/FloorPlan'
import type { PlanAmbulance, PlanBed } from '../plan/FloorPlan'
import Timeline from '../plan/Timeline'
import Drawer from './Drawer'
import { AdmitPanel, ChartPanel, WardPlate } from './BedPanel'
import InvoiceDetail from './InvoiceDetail'
import HowItWorks from './HowItWorks'
import Proof from './Proof'
import { Icon } from '../icons'
import { WARD_ORDER } from '../plan/layout'

/** How long "Replay six months" takes from the first morning to today. */
const REPLAY_MS = 12_000

type DrawerState =
  | { kind: 'bed'; bedId: number; note?: string }
  | { kind: 'bill'; invoice: ComputedInvoice; patientName: string; bedLabel: string; ward: string }

function liveBeds(engine: Engine): PlanBed[] {
  return engine.beds().map((b) => ({
    id: b.id,
    label: b.label,
    ward: b.ward,
    occupied: b.occupied,
    patientName: b.patientName,
    admittedAt: b.admittedAt,
    nights: b.admittedAt ? nightsBetween(b.admittedAt, ANCHOR_ISO) : undefined,
  }))
}

function firstFree(beds: BedView[]): BedView | undefined {
  return WARD_ORDER.flatMap((ward) =>
    beds.filter((b) => b.ward === ward && !b.occupied).sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true })),
  )[0]
}

export default function Hospital({ engine, actor }: { engine: Engine; actor: Actor }) {
  const planRef = useRef<HTMLDivElement | null>(null)
  const planWidth = useElementWidth(planRef)
  const reducedMotion = usePrefersReducedMotion()
  const [frames, setFrames] = useState<HistoryFrame[] | null>(null)
  const [position, setPosition] = useState<number | null>(null) // null = today
  const [playing, setPlaying] = useState(false)
  const [drawer, setDrawer] = useState<DrawerState | null>(null)

  // The whole history, one replay per morning, worked out once per database
  // (the visitor's own changes all happen "today", which the plan reads live).
  useEffect(() => {
    setFrames(null)
    const beds = engine.beds().map((b) => ({ id: b.id, label: b.label, ward: b.ward, ratePaise: b.ratePaise }))
    const timer = window.setTimeout(() => setFrames(historyFrames(engine.eventsLog(), beds, ANCHOR_ISO)), 60)
    return () => window.clearTimeout(timer)
  }, [engine])

  const last = frames ? frames.length - 1 : 0
  const atToday = position === null || position >= last
  const frame = !atToday && frames && position !== null ? frames[position] : undefined

  // Playback: walk the position from the first morning (or where it stands) to today.
  useEffect(() => {
    if (!playing || !frames) return
    const from = position === null || position >= last ? 0 : position
    const perDay = REPLAY_MS / Math.max(1, last)
    const started = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const next = Math.min(last, from + Math.floor((now - started) / perDay))
      setPosition(next >= last ? null : next)
      if (next >= last) {
        setPlaying(false)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // `position` is read once, as the starting point; from then on the loop owns it.
  }, [playing, frames])

  const bedsNow = engine.beds()
  const live = liveBeds(engine)
  const planBeds: PlanBed[] = frame
    ? frame.beds.map((b) => ({ id: b.id, label: b.label, ward: b.ward, occupied: b.occupied, patientName: b.patientName }))
    : live
  const ambulancesNow = engine.ambulances()
  const planAmbulances: PlanAmbulance[] = ambulancesNow.map((a) => ({
    id: a.id,
    plate: a.plate,
    outTo: frame ? frame.ambulancesOut.find((o) => o.ambulanceId === a.id)?.location : a.openDispatch?.location,
  }))

  const inUse = planBeds.filter((b) => b.occupied).length
  const byWard = WARD_ORDER.map((ward) => {
    const beds = planBeds.filter((b) => b.ward === ward)
    return { ward, total: beds.length, used: beds.filter((b) => b.occupied).length }
  })

  const latest = engine.eventsLog(1)[0]
  const eventCount = latest?.id ?? 0
  // Re-read the names whenever the log grows (a new patient, a new dispatch).
  const names = useMemo(() => eventNamesFrom(engine, engine.eventsLog()), [engine, eventCount])
  const latestSentence = latest ? describeEvent(latest, names) : undefined

  // Every point is a replayed morning except the last, which is today, read live.
  const occupiedToday = live.filter((b) => b.occupied).length
  const timelinePoints = useMemo(() => {
    if (!frames) return []
    return frames.map((f, i) => (i === frames.length - 1 ? { iso: f.iso, occupied: occupiedToday } : f))
  }, [frames, occupiedToday])

  function scrub(index: number): void {
    setPlaying(false)
    setDrawer(null)
    setPosition(index >= last ? null : index)
  }

  function togglePlay(): void {
    if (!frames) return
    setDrawer(null)
    setPlaying((p) => !p)
  }

  function replaySixMonths(): void {
    if (!frames) return
    setDrawer(null)
    setPosition(0)
    setPlaying(true)
    planRef.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' })
  }

  function admitSomeone(): void {
    setPlaying(false)
    setPosition(null)
    const bed = firstFree(bedsNow)
    setDrawer(bed ? { kind: 'bed', bedId: bed.id } : null)
  }

  const variant = planWidth > 0 && planWidth < 640 ? 'tall' : 'wide'
  const drawerBed = drawer?.kind === 'bed' ? bedsNow.find((b) => b.id === drawer.bedId) : undefined
  const freeBeds = bedsNow.filter((b) => !b.occupied)
  const noFreeBed = freeBeds.length === 0

  const planLabel = frame
    ? `The hospital on the morning of ${formatDateIST(frame.iso)}, replayed from the event log: ${inUse} of ${planBeds.length} beds in use.`
    : `The hospital today: ${inUse} of ${planBeds.length} beds in use. Select a bed to admit a patient or open a chart.`

  return (
    <div className="hospital">
      <section className="hero" aria-labelledby="hero-title">
        <div className="sign">
          <h1 id="hero-title" className="sign__title">
            A whole hospital, running in this browser tab.
          </h1>
          <p className="sign__lead">
            WardOS runs a 32-bed hospital on a real SQLite database inside the page: admissions, bills, ambulances
            and staff pay, with six months of history behind them. Nothing you do here leaves your device.
          </p>

          <ul className="directory" aria-label={frame ? `Beds in use on ${formatDateIST(frame.iso)}` : 'Beds in use today'}>
            {byWard.map((w) => (
              <li key={w.ward} className={`directory__row directory__row--${WARD_TOKENS[w.ward]}`}>
                <span className="directory__dot" aria-hidden="true" />
                <span className="directory__name">{WARD_LABELS[w.ward]}</span>
                <span className="directory__count num">
                  {w.used} <span className="directory__of">of {w.total} in use</span>
                </span>
              </li>
            ))}
          </ul>

          <div className="sign__actions">
            <button type="button" className="button button--signal" onClick={admitSomeone} disabled={noFreeBed}>
              <Icon name="bed" />
              Admit a patient
            </button>
            <button type="button" className="button button--on-sign" onClick={replaySixMonths} disabled={!frames}>
              <Icon name="replay" />
              Replay six months
            </button>
          </div>
          <p className="sign__foot">
            {noFreeBed
              ? 'Every bed is taken. Open a chart and discharge someone first.'
              : 'Or click any bed on the plan. Free beds take a new patient, taken beds open the chart.'}
          </p>
        </div>

        <div className="plan-card">
          <div className="plan-card__bar">
            {frame ? (
              <p className="status status--history">
                <Icon name="rewind" size={18} />
                <span>
                  <strong>{formatDateIST(frame.iso)}</strong>, replayed from the event log
                </span>
              </p>
            ) : (
              <p className="status status--live">
                <span className="live-dot" aria-hidden="true" />
                <span>
                  <strong>Today</strong>, {formatDateTimeIST(ANCHOR_ISO)}
                </span>
              </p>
            )}
            <p className="plan-card__count">
              <strong className="num">{inUse}</strong> of {planBeds.length} beds in use
            </p>
          </div>

          <div className="plan-card__plan" ref={planRef}>
            {planWidth > 0 && (
              <FloorPlan
                beds={planBeds}
                ambulances={planAmbulances}
                variant={variant}
                interactive={!frame}
                selectedBedId={drawer?.kind === 'bed' ? drawer.bedId : null}
                onSelectBed={(bed) => setDrawer({ kind: 'bed', bedId: bed.id })}
                onSelectAmbulance={() => navigateTo('ambulances')}
                label={planLabel}
              />
            )}
          </div>

          {frames ? (
            <Timeline
              points={timelinePoints}
              index={position ?? last}
              onScrub={scrub}
              playing={playing}
              onTogglePlay={togglePlay}
              bedsTotal={planBeds.length}
            />
          ) : (
            <p className="timeline timeline--loading">Replaying six months of history…</p>
          )}

          {latestSentence && latest && (
            <p className="ticker" key={latest.id} aria-live="polite">
              <span className={`ticker__kind ticker__kind--${latestSentence.kind}`} aria-hidden="true" />
              <span className="ticker__text">
                <span className="ticker__label">Latest</span> {latestSentence.who} {latestSentence.did}
              </span>
              <span className="ticker__meta">Event {latest.id.toLocaleString('en-IN')}</span>
            </p>
          )}
        </div>
      </section>

      <HowItWorks engine={engine} actor={actor} />
      <Proof />

      {drawer?.kind === 'bed' && drawerBed && (
        <Drawer
          kicker={
            <>
              <WardPlate ward={drawerBed.ward} label={drawerBed.label} /> {WARD_LABELS[drawerBed.ward]}
            </>
          }
          title={drawerBed.occupied ? (drawerBed.patientName ?? 'Patient') : 'Admit a patient'}
          onClose={() => setDrawer(null)}
        >
          {drawer.note && (
            <p className="notice notice--ok" role="status">
              <Icon name="check" size={18} /> {drawer.note}
            </p>
          )}
          {drawerBed.occupied && drawerBed.admissionId !== undefined ? (
            <ChartPanel
              key={drawerBed.admissionId}
              engine={engine}
              actor={actor}
              admissionId={drawerBed.admissionId}
              anchorIso={ANCHOR_ISO}
              onMoved={(bedId) => setDrawer({ kind: 'bed', bedId, note: 'Moved. This is the new bed.' })}
              onDischarged={(invoice, patientName) =>
                setDrawer({ kind: 'bill', invoice, patientName, bedLabel: drawerBed.label, ward: drawerBed.ward })
              }
            />
          ) : (
            <AdmitPanel
              engine={engine}
              actor={actor}
              bed={drawerBed}
              freeBeds={freeBeds}
              onPickBed={(bedId) => setDrawer({ kind: 'bed', bedId })}
              onAdmitted={(_admissionId, patientName) =>
                setDrawer({
                  kind: 'bed',
                  bedId: drawerBed.id,
                  note: `${patientName || 'The patient'} is in ${drawerBed.label}. Their bill has started; add charges or discharge them below.`,
                })
              }
            />
          )}
        </Drawer>
      )}

      {drawer?.kind === 'bill' && (
        <Drawer
          kicker={
            <>
              <WardPlate ward={drawer.ward} label={drawer.bedLabel} /> Discharged
            </>
          }
          title={`Bill for ${drawer.patientName}`}
          onClose={() => setDrawer(null)}
        >
          <p className="notice notice--ok" role="status">
            <Icon name="check" size={18} /> Discharged. {drawer.bedLabel} is free again, and this bill can no longer
            change.
          </p>
          <InvoiceDetail invoice={drawer.invoice} issuedAt={ANCHOR_ISO} final />
          <button type="button" className="button button--block" onClick={() => setDrawer(null)} data-autofocus>
            Back to the floor plan
          </button>
        </Drawer>
      )}
    </div>
  )
}
