import type { Engine } from '../../core/engine'
import { deckVm } from '../viewmodels'
import { formatINR, formatDateTimeIST } from '../format'

const KIND_LABELS: Record<string, string> = {
  PROCEDURE: 'Procedures',
  PHARMACY: 'Pharmacy',
  CONSULTATION: 'Consultation',
  TRANSPORT: 'Transport',
}

/**
 * The command deck: the hospital's whole operating picture at a glance,
 * read live off `engine` at every render (via `deckVm` — census, per-ward
 * occupancy, revenue-by-kind and outstanding balance from discharged
 * invoices, refund count, and the last 10 events) so it always reflects
 * this session's actual db, including any demo mutation made on another
 * screen. The default post-login screen (see App.tsx).
 */
export default function CommandDeck({ engine }: { engine: Engine }) {
  const vm = deckVm(engine)
  const maxRevenue = Math.max(1, ...vm.revenueByKind.map((r) => r.totalPaise))
  const maxWardBeds = Math.max(1, ...vm.occupancyByWard.map((w) => w.bedsTotal))

  return (
    <section className="command-deck">
      <div className="stat-tiles">
        <div className="stat-tile">
          <span className="stat-tile__label">Patients</span>
          <span className="stat-tile__value">{vm.census.patients}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile__label">Active admissions</span>
          <span className="stat-tile__value">{vm.census.active}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile__label">Beds free</span>
          <span className="stat-tile__value">
            {vm.census.bedsFree}
            <span className="stat-tile__value-of">/{vm.census.bedsTotal}</span>
          </span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile__label">Outstanding</span>
          <span className="stat-tile__value stat-tile__value--money">{formatINR(vm.outstandingPaise)}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile__label">Refunds issued</span>
          <span className="stat-tile__value">{vm.refundCount}</span>
        </div>
      </div>

      <div className="deck-columns">
        <section className="deck-section" aria-label="Occupancy by ward">
          <h2>Occupancy by ward</h2>
          <div className="occupancy-bars">
            {vm.occupancyByWard.map((w) => (
              <div key={w.ward} className="occupancy-bar-row">
                <span className="occupancy-bar-row__label">{w.ward}</span>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{ width: `${w.bedsTotal === 0 ? 0 : (w.occupied / maxWardBeds) * 100}%` }}
                  />
                </div>
                <span className="occupancy-bar-row__count">
                  {w.occupied}/{w.bedsTotal}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="deck-section" aria-label="Revenue mix">
          <h2>Revenue mix</h2>
          <div className="occupancy-bars">
            {vm.revenueByKind.map((r) => (
              <div key={r.kind} className="occupancy-bar-row">
                <span className="occupancy-bar-row__label">{KIND_LABELS[r.kind] ?? r.kind}</span>
                <div className="bar-track">
                  <div
                    className="bar-fill bar-fill--revenue"
                    style={{ width: `${(r.totalPaise / maxRevenue) * 100}%` }}
                  />
                </div>
                <span className="occupancy-bar-row__count">{formatINR(r.totalPaise)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="deck-section" aria-label="Recent events">
        <h2>Recent activity</h2>
        {vm.recentEvents.length === 0 ? (
          <p>No events yet.</p>
        ) : (
          <table className="deck-events-table">
            <thead>
              <tr>
                <th>Time (IST)</th>
                <th>Action</th>
                <th>Entity</th>
              </tr>
            </thead>
            <tbody>
              {vm.recentEvents.map((e) => (
                <tr key={e.id}>
                  <td>{formatDateTimeIST(e.at)}</td>
                  <td>{e.action}</td>
                  <td>
                    {e.entity}
                    {e.entityId !== null ? `#${e.entityId}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </section>
  )
}
