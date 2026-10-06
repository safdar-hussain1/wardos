import type { Engine } from '../core/engine'
import { replay, snapshotFromDb, snapshotsEqual } from '../core/replay'
import { DEMO_ACCOUNTS } from '../seed/facility'

/**
 * The three things the "How it works" section lets a visitor try against
 * the live database. Each one asks the real engine or the real SQLite
 * schema, and none of them changes anything: the first two are refused
 * before any row is written, the third only reads.
 */

export interface RefusalResult {
  /** The refusal, word for word as the engine or SQLite raised it. */
  message: string
  /** What the attempt was aimed at, for the sentence around the message. */
  patientName: string
  bedLabel: string
}

/**
 * Signs in as the demo nurse (a real bcrypt check) and asks the engine to
 * discharge someone. The engine's permission check refuses before the
 * database is touched. Returns undefined when nobody is in a bed to try it on.
 */
export function tryDischargeAsNurse(engine: Engine): RefusalResult | undefined {
  const target = engine.admissionsActive()[0]
  if (!target) return undefined
  const nurseAccount = DEMO_ACCOUNTS.find((a) => a.role === 'NURSE')
  if (!nurseAccount) throw new Error('the demo has no nurse account')
  const nurse = engine.authenticate(nurseAccount.username, nurseAccount.password)
  try {
    engine.discharge(nurse, { admissionId: target.id })
  } catch (err) {
    return {
      message: err instanceof Error ? err.message : String(err),
      patientName: target.patientName,
      bedLabel: target.bedLabel,
    }
  }
  throw new Error('the engine let a nurse discharge a patient')
}

/**
 * Inserts a second active admission into an occupied bed with raw SQL,
 * going around the engine entirely, the way a buggy screen or a direct
 * database edit would. The schema's partial unique index refuses it.
 * Returns undefined when every bed is free.
 */
export function tryDoubleBooking(engine: Engine): RefusalResult | undefined {
  const bed = engine.beds().find((b) => b.occupied)
  if (!bed || bed.patientName === undefined) return undefined
  const admitted = new Set(engine.admissionsActive().map((a) => a.patientId))
  const other = engine.patients().find((p) => !admitted.has(p.id))
  if (!other) return undefined
  try {
    engine.db.run(
      `INSERT INTO admissions (patient_id,bed_id,diagnosis,deposit_paise,status,admitted_at)
       VALUES (?,?,?,?,'ACTIVE',?)`,
      [other.id, bed.id, 'second booking attempt', 0, engine.clock.now().toISOString()],
    )
  } catch (err) {
    return {
      message: err instanceof Error ? err.message : String(err),
      patientName: other.name,
      bedLabel: bed.label,
    }
  }
  throw new Error('the database accepted a second patient in an occupied bed')
}

/**
 * The one-patient-per-bed rule exactly as the running database stores it
 * (SQLite keeps every index's CREATE statement in sqlite_master).
 */
export function bedRule(engine: Engine): string | undefined {
  return engine.db.get<{ sql: string }>(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'uq_active_bed'`)
    ?.sql
}

export interface ReplayCheckResult {
  identical: boolean
  events: number
  patients: number
  stays: number
  bills: number
  /** Mismatches found, if any (empty when identical). */
  differences: string[]
  milliseconds: number
}

/**
 * Replays the hospital from nothing but the event log and compares it,
 * table by table and field by field, with the live database.
 */
export function replayCheck(engine: Engine, now: () => number = () => performance.now()): ReplayCheckResult {
  const started = now()
  const events = engine.eventsLog()
  const beds = engine.beds().map((b) => ({ id: b.id, label: b.label, ward: b.ward, ratePaise: b.ratePaise }))
  const replayed = replay(events, beds)
  const { equal, diff } = snapshotsEqual(replayed, snapshotFromDb(engine.db))
  return {
    identical: equal,
    events: events.length,
    patients: replayed.patients.size,
    stays: replayed.admissions.size,
    bills: replayed.invoices.size,
    differences: diff,
    milliseconds: now() - started,
  }
}
