import { Fragment, useState } from 'react'
import type { Engine, Actor } from '../../core/engine'
import type { EventAction } from '../../core/events'
import { formatDateTimeIST } from '../format'
import { auditPageVm } from '../viewmodels'

const PAGE_SIZE = 50

export default function AuditTrail({ engine, actor }: { engine: Engine; actor: Actor }) {
  const [page, setPage] = useState(1)
  const [actionFilter, setActionFilter] = useState<EventAction | 'ALL'>('ALL')
  const [expandedId, setExpandedId] = useState<number | null>(null)

  // Nav already hides this link for non-ADMIN roles; guard here too.
  if (actor.role !== 'ADMIN') {
    return <p className="access-denied">Audit trail is restricted to administrators.</p>
  }

  const events = engine.eventsLog()
  const users = engine.users()
  const vm = auditPageVm(events, users, { page, pageSize: PAGE_SIZE, actionFilter })

  function handleFilterChange(value: string): void {
    setActionFilter(value === 'ALL' ? 'ALL' : (value as EventAction))
    setPage(1)
  }

  return (
    <section className="audit-trail">
      <div className="audit-controls">
        <label>
          Filter by action
          <select value={actionFilter} onChange={(e) => handleFilterChange(e.target.value)}>
            <option value="ALL">All actions</option>
            {vm.availableActions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <span className="audit-count">{vm.totalCount} events</span>
      </div>

      {vm.rows.length === 0 ? (
        <p>No events match this filter.</p>
      ) : (
        <div className="table-scroll">
        <table className="audit-table">
          <thead>
            <tr>
              <th>Time (IST)</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Payload</th>
            </tr>
          </thead>
          <tbody>
            {vm.rows.map((row) => (
              <Fragment key={row.id}>
                <tr
                  className="audit-row"
                  onClick={() => setExpandedId((id) => (id === row.id ? null : row.id))}
                >
                  <td className="cell-time">{formatDateTimeIST(row.atIso)}</td>
                  <td>{row.actorUsername}</td>
                  <td>
                    <span className="event-chip">{row.action}</span>
                  </td>
                  <td>
                    {row.entity}
                    {row.entityId !== null ? `#${row.entityId}` : ''}
                  </td>
                  <td className="audit-payload-summary">{row.payloadSummary}</td>
                </tr>
                {expandedId === row.id && (
                  <tr className="audit-payload-row">
                    <td colSpan={5}>
                      <pre>{row.payloadPretty}</pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        </div>
      )}

      <div className="audit-pager">
        <button type="button" disabled={!vm.hasPrev} onClick={() => setPage((p) => p - 1)}>
          Prev
        </button>
        <span>
          Page {vm.page} of {vm.totalPages}
        </span>
        <button type="button" disabled={!vm.hasNext} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
      </div>
    </section>
  )
}
