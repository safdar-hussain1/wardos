import { useState } from 'react'
import type { Engine, Actor } from '../../core/engine'
import type { EventAction } from '../../core/events'
import { formatDateTimeIST } from '../format'
import { auditPageVm, describeEvent, eventNamesFrom } from '../viewmodels'
import { Icon } from '../icons'

const PAGE_SIZE = 40

const ACTION_NAMES: Record<EventAction, string> = {
  PATIENT_REGISTERED: 'New patients',
  ADMITTED: 'Admissions',
  TRANSFERRED: 'Bed moves',
  CHARGE_ADDED: 'Charges',
  DEPOSIT_RECORDED: 'Deposits',
  DISCHARGED: 'Discharges',
  AMBULANCE_DISPATCHED: 'Ambulances sent',
  AMBULANCE_RETURNED: 'Ambulances back',
  USER_CREATED: 'Logins created',
  STAFF_ADDED: 'Staff added',
}

export default function AuditTrail({ engine, actor }: { engine: Engine; actor: Actor }) {
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<EventAction | 'ALL'>('ALL')
  const [openId, setOpenId] = useState<number | null>(null)

  // The router keeps other roles out; this guard keeps the log private if it ever renders anyway.
  if (actor.role !== 'ADMIN') return null

  const events = engine.eventsLog()
  const byId = new Map(events.map((e) => [e.id, e]))
  const names = eventNamesFrom(engine, events)
  const vm = auditPageVm(events, engine.users(), { page, pageSize: PAGE_SIZE, actionFilter: filter })

  return (
    <section className="page" aria-labelledby="log-title">
      <header className="page-head">
        <h1 id="log-title">Event log</h1>
        <p>
          Every change ever made to this hospital, newest first. The log only grows: the database itself refuses to
          edit or delete a line, and replaying it from the top gives back the whole hospital.
        </p>
      </header>

      <div className="toolbar">
        <label className="field field--inline">
          <span className="field__label">Show</span>
          <select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value === 'ALL' ? 'ALL' : (e.target.value as EventAction))
              setPage(1)
              setOpenId(null)
            }}
          >
            <option value="ALL">Everything</option>
            {vm.availableActions.map((a) => (
              <option key={a} value={a}>
                {ACTION_NAMES[a] ?? a}
              </option>
            ))}
          </select>
        </label>
        <p className="toolbar__count">
          <strong className="num">{vm.totalCount.toLocaleString('en-IN')}</strong> events
        </p>
      </div>

      {vm.rows.length === 0 ? (
        <p className="empty">Nothing of that kind has happened yet.</p>
      ) : (
        <ol className="log">
          {vm.rows.map((row) => {
            const event = byId.get(row.id)
            const sentence = event ? describeEvent(event, names) : undefined
            const open = openId === row.id
            return (
              <li key={row.id} className={`log__item${open ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className="log__row"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : row.id)}
                >
                  <span className={`log__kind log__kind--${sentence?.kind ?? 'people'}`} aria-hidden="true" />
                  <span className="log__text">
                    <strong>{sentence?.who ?? row.actorUsername}</strong> {sentence?.did ?? row.action}
                  </span>
                  <span className="log__when">{formatDateTimeIST(row.atIso)}</span>
                  <span className="log__id num">#{row.id}</span>
                  <Icon name="chevron" size={16} className="log__chev" />
                </button>
                {open && (
                  <div className="log__raw">
                    <p>
                      Stored as <code>{row.action}</code> on <code>{row.entity}{row.entityId !== null ? ` ${row.entityId}` : ''}</code>, by{' '}
                      <code>{row.actorUsername}</code>:
                    </p>
                    <pre className="code">
                      <code>{row.payloadPretty}</code>
                    </pre>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}

      <nav className="pager" aria-label="Event log pages">
        <button type="button" className="button button--ghost" disabled={!vm.hasPrev} onClick={() => setPage((p) => p - 1)}>
          Newer
        </button>
        <span>
          Page {vm.page} of {vm.totalPages}
        </span>
        <button type="button" className="button button--ghost" disabled={!vm.hasNext} onClick={() => setPage((p) => p + 1)}>
          Older
        </button>
      </nav>
    </section>
  )
}
