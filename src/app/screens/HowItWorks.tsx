import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Engine, Actor } from '../../core/engine'
import { can } from '../../core/permissions'
import { bedRule, tryDischargeAsNurse, tryDoubleBooking, replayCheck } from '../demos'
import type { RefusalResult, ReplayCheckResult } from '../demos'
import { ACTION_COLUMNS, ROLE_LABELS, ROLE_ORDER } from '../labels'
import { describeEvent, eventNamesFrom } from '../viewmodels'
import { Icon } from '../icons'

type Outcome<T> = { state: 'idle' } | { state: 'done'; result: T } | { state: 'nothing'; reason: string }

function Result({ tone, children }: { tone: 'refused' | 'ok' | 'info'; children: ReactNode }) {
  return (
    <div className={`result result--${tone}`} role="status">
      <Icon name={tone === 'ok' ? 'check' : tone === 'refused' ? 'shield' : 'info'} size={20} />
      <div>{children}</div>
    </div>
  )
}

function PermissionTable({ role }: { role: Actor['role'] }) {
  return (
    // focusable, so a keyboard can scroll it when it is wider than a phone
    <div className="perm-wrap" tabIndex={0} role="region" aria-label="Who may do what">
      <table className="perm">
        <caption className="sr-only">Which role may do which action. Your current role is highlighted.</caption>
        <thead>
          <tr>
            <th scope="col">Role</th>
            {ACTION_COLUMNS.map((c) => (
              <th scope="col" key={c.permission}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROLE_ORDER.map((r) => (
            <tr key={r} className={r === role ? 'is-you' : undefined}>
              <th scope="row">
                {ROLE_LABELS[r]}
                {r === role && <span className="perm__you">you</span>}
              </th>
              {ACTION_COLUMNS.map((c) => (
                <td key={c.permission}>
                  {can(r, c.permission) ? (
                    <span className="perm__yes">
                      <Icon name="check" size={16} />
                      <span className="sr-only">allowed</span>
                    </span>
                  ) : (
                    <span className="perm__no">
                      <span aria-hidden="true">–</span>
                      <span className="sr-only">not allowed</span>
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The last few lines of the event log, as sentences: the record the replay works from. */
function LogTail({ engine }: { engine: Engine }) {
  const recent = engine.eventsLog(3)
  const names = eventNamesFrom(engine, engine.eventsLog())
  return (
    <ol className="logtail" aria-label="The newest lines of the event log">
      {recent.map((e) => {
        const s = describeEvent(e, names)
        return (
          <li key={e.id}>
            <span className="logtail__id num">#{e.id.toLocaleString('en-IN')}</span>
            <span>
              {s.who} {s.did}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export default function HowItWorks({ engine, actor }: { engine: Engine; actor: Actor }) {
  const [nurse, setNurse] = useState<Outcome<RefusalResult>>({ state: 'idle' })
  const [twice, setTwice] = useState<Outcome<RefusalResult>>({ state: 'idle' })
  const [check, setCheck] = useState<Outcome<ReplayCheckResult>>({ state: 'idle' })

  function runNurse(): void {
    const result = tryDischargeAsNurse(engine)
    setNurse(result ? { state: 'done', result } : { state: 'nothing', reason: 'Nobody is in a bed right now. Admit someone first, then try again.' })
  }

  function runTwice(): void {
    const result = tryDoubleBooking(engine)
    setTwice(
      result
        ? { state: 'done', result }
        : { state: 'nothing', reason: 'Every bed is free right now. Admit someone first, then try again.' },
    )
  }

  function runCheck(): void {
    setCheck({ state: 'done', result: replayCheck(engine) })
  }

  const occupiedBed = engine.beds().find((b) => b.occupied)
  const rule = bedRule(engine)

  return (
    <section className="how" id="how-it-works" aria-labelledby="how-title">
      <div className="section-head">
        <h2 id="how-title">How it works</h2>
        <p>
          Three rules hold the whole system together. Each one is live on this page, so try to break it.
        </p>
      </div>

      <ol className="route">
        <li className="stop">
          <span className="stop__num" aria-hidden="true">
            1
          </span>
          <div className="stop__text">
            <h3>Every action is checked against your role</h3>
            <p>
              Each button sends a command to the engine, and the engine checks your role before it touches the
              database. Hiding a button is only a courtesy. The check underneath is what counts.
            </p>
          </div>
          <div className="stop__demo">
          <PermissionTable role={actor.role} />
          <button type="button" className="button" onClick={runNurse}>
            Try a discharge as the nurse
          </button>
          {nurse.state === 'done' && (
            <Result tone="refused">
              <p>
                Refused before anything changed. Asked to discharge {nurse.result.patientName} from{' '}
                {nurse.result.bedLabel}, the engine answered:
              </p>
              <p className="result__quote">{nurse.result.message}</p>
            </Result>
          )}
          {nurse.state === 'nothing' && <Result tone="info">{nurse.reason}</Result>}
          </div>
        </li>

        <li className="stop">
          <span className="stop__num" aria-hidden="true">
            2
          </span>
          <div className="stop__text">
            <h3>The database refuses a double booking</h3>
            <p>
              One patient per bed is written into the database itself, not the screen. Even code that skips the
              engine and writes straight to SQLite cannot put a second patient in a bed.
            </p>
          </div>
          <div className="stop__demo">
          {rule && (
            <pre className="code" aria-label="The rule, as the running database stores it">
              <code>{`${rule.replace(' ON ', '\n  ON ').replace(' WHERE ', '\n  WHERE ')};`}</code>
            </pre>
          )}
          <button type="button" className="button" onClick={runTwice}>
            {occupiedBed ? `Try to put a second patient in ${occupiedBed.label}` : 'Try a double booking'}
          </button>
          {twice.state === 'done' && (
            <Result tone="refused">
              <p>
                Refused. {twice.result.bedLabel} is taken, so the insert for {twice.result.patientName} failed and
                nothing was written. SQLite said:
              </p>
              <p className="result__quote">{twice.result.message}</p>
            </Result>
          )}
          {twice.state === 'nothing' && <Result tone="info">{twice.reason}</Result>}
          </div>
        </li>

        <li className="stop">
          <span className="stop__num" aria-hidden="true">
            3
          </span>
          <div className="stop__text">
            <h3>Every change is written down, and can be replayed</h3>
            <p>
              A command saves its change and one line in an append-only event log, in the same transaction. Replay
              the log from the start and you get the hospital back exactly, which is how the time machine above
              works.
            </p>
          </div>
          <div className="stop__demo">
          <LogTail engine={engine} />
          <button type="button" className="button" onClick={runCheck}>
            Replay the log and compare
          </button>
          {check.state === 'done' &&
            (check.result.identical ? (
              <Result tone="ok">
                <p>
                  Replayed {check.result.events.toLocaleString('en-IN')} events in{' '}
                  {Math.max(1, Math.round(check.result.milliseconds))} ms: {check.result.patients} patients,{' '}
                  {check.result.stays} stays and {check.result.bills} bills. Identical to the live database, table by
                  table and field by field.
                </p>
              </Result>
            ) : (
              <Result tone="refused">
                <p>
                  The replay differs from the live database in {check.result.differences.length} place
                  {check.result.differences.length === 1 ? '' : 's'}: {check.result.differences.slice(0, 2).join('; ')}
                </p>
              </Result>
            ))}
          </div>
        </li>
      </ol>
    </section>
  )
}
