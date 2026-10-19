import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { Engine, Actor, BedView } from '../../core/engine'
import type { ComputedInvoice } from '../../core/billing'
import { nightsBetween } from '../../core/billing'
import { ANCHOR_ISO } from '../../core/clock'
import { describeEvent, eventNamesFrom, historyInstant, historyTimeline, timeMachineVm, WARD_ORDER } from '../viewmodels'
import type { HistoryFrame } from '../viewmodels'
import { formatDateIST, formatDateTimeIST } from '../format'
import { WARD_LABELS, WARD_TOKENS } from '../labels'
import { useElementWidth, usePrefersReducedMotion, navigateTo, useHashRoute } from '../hooks'
import { isHowItWorksHash } from '../routes'
import FloorPlan from '../plan/FloorPlan'
import type { PlanAmbulance, PlanBed } from '../plan/FloorPlan'
import Timeline from '../plan/Timeline'
import Drawer from './Drawer'
import { AdmitPanel, ChartPanel, WardPlate } from './BedPanel'
import InvoiceDetail from './InvoiceDetail'
import HowItWorks from './HowItWorks'
import Proof from './Proof'
import { Icon } from '../icons'
import { CountUp } from '../motion'

// Neither section needs to redraw while the time machine plays: How it
// works changes only when the event log grows, the proof figure never.
const HowItWorksSection = memo(HowItWorks)
const ProofSection = memo(Proof)

/** How many mornings to replay per slice, so building the history never blocks the page for long. */
const FRAMES_PER_SLICE = 12

/** How long "Replay six months" takes from the first morning to today. */
const REPLAY_MS = 12_000

/** How long the arrival sequence runs (walls, floor lines, beds, counters, chart). */
const INTRO_MS = 2800

/**
 * The arrival sequence plays once per page load: coming back to this view
 * from Bills or Staff shows the hospital at once.
 */
let arrivedOnce = false

type DrawerState =
  | { kind: 'bed'; bedId: number; note?: string }
  | { kind: 'bill'; invoice: ComputedInvoice; patientName: string; bedLabel: string; ward: string }

function toPlanBeds(beds: BedView[]): PlanBed[] {
  return beds.map((b) => ({
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
  const [replayRun, setReplayRun] = useState(0)
  const [intro, setIntro] = useState(() => !arrivedOnce)
  const { hash } = useHashRoute()

  useEffect(() => {
    arrivedOnce = true
    if (!intro) return
    const timer = window.setTimeout(() => setIntro(false), INTRO_MS)
    return () => window.clearTimeout(timer)
  }, [intro])

  // The whole history, one replay per morning, worked out once per database
  // (the visitor's own changes all happen "today", which the plan reads
  // live). Built a few mornings per slice, yielding between slices, so the
  // arrival animation and the page stay responsive while it runs.
  useEffect(() => {
    setFrames(null)
    const beds = engine.beds().map((b) => ({ id: b.id, label: b.label, ward: b.ward, ratePaise: b.ratePaise }))
    const events = engine.eventsLog()
    const timeline = historyTimeline(events, ANCHOR_ISO)
    const built: HistoryFrame[] = []
    let day = 0
    let timer = 0
    const slice = () => {
      const end = Math.min(timeline.days, day + FRAMES_PER_SLICE - 1)
      for (; day <= end; day++) {
        const vm = timeMachineVm(events, beds, historyInstant(timeline, ANCHOR_ISO, day))
        built.push({ iso: vm.uptoIso, occupied: vm.activeAdmissions, beds: vm.beds, ambulancesOut: vm.ambulancesOut })
      }
      if (day > timeline.days) setFrames(built)
      else timer = window.setTimeout(slice, 0)
    }
    timer = window.setTimeout(slice, 120)
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
      // the first frame's timestamp can precede `started`; never step backwards
      const next = Math.min(last, from + Math.floor(Math.max(0, now - started) / perDay))
      setPosition(next >= last ? null : next)
      if (next >= last) {
        setPlaying(false)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // `position` is read once, as the starting point; from then on the loop
    // owns it. `replayRun` restarts it when "Replay six months" is pressed mid-play.
  }, [playing, frames, replayRun])

  // A link to #how-it-works scrolls there before the plan and the chart have
  // their real height; once they do, put the section back at the top.
  const planReady = planWidth > 0 && frames !== null
  useEffect(() => {
    if (!planReady || !isHowItWorksHash(window.location.hash)) return
    document.getElementById('how-it-works')?.scrollIntoView({ block: 'start' })
  }, [planReady, hash])

  const bedsNow = engine.beds()
  const live = toPlanBeds(bedsNow)
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
    setReplayRun((n) => n + 1)
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
    <div className={`hospital${intro ? ' hospital--intro' : ''}`}>
      <section className="hero" aria-labelledby="hero-title">
        <div className="sign">
          <h1 id="hero-title" className="sign__title">
            A whole hospital, running in this browser tab.
          </h1>
          <p className="sign__lead">
            WardOS runs a 32-bed hospital on a real SQLite database inside the page: admissions, bills, ambulances
            and staff pay, with six months of history behind them. Nothing you do here leaves your device.
          </p>
          <ul className="sign__facts">
            <li>
              <Icon name="database" size={18} />A real SQLite database, running in the page
            </li>
            <li>
              <Icon name="log" size={18} />
              Every change logged, and replayable
            </li>
            <li>
              <Icon name="shield" size={18} />
              Money kept in exact paise, never floats
            </li>
          </ul>

          <ul className="directory" aria-label={frame ? `Beds in use on ${formatDateIST(frame.iso)}` : 'Beds in use today'}>
            {byWard.map((w, i) => (
              <li key={w.ward} className={`directory__row directory__row--${WARD_TOKENS[w.ward]}`}>
                <span className="directory__dot" aria-hidden="true" />
                <span className="directory__name">{WARD_LABELS[w.ward]}</span>
                <span className="directory__count num">
                  <CountUp value={w.used} play={intro} delay={1300 + i * 90} />{' '}
                  <span className="directory__of">of {w.total} in use</span>
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

        <div className={`plan-card${frame ? ' plan-card--history' : ''}`}>
          {frame && position !== null && (
            <div className="replaybar" style={{ ['--p' as string]: position / Math.max(1, last) }} aria-hidden="true" />
          )}
          <div className="plan-card__bar">
            {frame ? (
              <p className="status status--history">
                <Icon name="rewind" size={20} />
                <span className="status__date num">{formatDateIST(frame.iso)}</span>
                <span className="status__note">{playing ? 'Replaying the event log' : 'Replayed from the event log'}</span>
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
              <strong className="num">
                <CountUp value={inUse} play={intro} delay={1300} />
              </strong>{' '}
              of {planBeds.length} beds in use
            </p>
          </div>

          <div className="plan-card__plan" ref={planRef}>
            {planWidth > 0 && (
              <FloorPlan
                beds={planBeds}
                ambulances={planAmbulances}
                variant={variant}
                intro={intro}
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
              intro={intro}
            />
          ) : (
            <p className="timeline timeline--loading">Replaying six months of history…</p>
          )}

          {/* One stable live region; only its contents change, so a screen reader announces each new event. */}
          <p className="ticker" aria-live="polite">
            {latestSentence && latest && (
              <span className="ticker__inner" key={latest.id}>
                <span className={`ticker__kind ticker__kind--${latestSentence.kind}`} aria-hidden="true" />
                <span className="ticker__text">
                  <span className="ticker__label">Latest</span> {latestSentence.who} {latestSentence.did}
                </span>
                <span className="ticker__meta">Event {latest.id.toLocaleString('en-IN')}</span>
              </span>
            )}
          </p>
        </div>
      </section>

      <HowItWorksSection engine={engine} actor={actor} logVersion={eventCount} />
      <ProofSection />

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
          <p className="sr-only" role="status" aria-live="polite">
            {drawer.note ?? ''}
          </p>
          {drawer.note && (
            <p className="notice notice--ok">
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
              onMoved={(bedId) => setDrawer({ kind: 'bed', bedId })}
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
          <button type="button" className="button button--block" data-close data-autofocus>
            Back to the floor plan
          </button>
        </Drawer>
      )}
    </div>
  )
}
