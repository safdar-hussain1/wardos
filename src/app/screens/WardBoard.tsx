import { useState } from 'react'
import type { Engine, Actor, BedView } from '../../core/engine'
import { bedGrid } from '../viewmodels'
import AdmitDialog from './AdmitDialog'
import PatientChart from './PatientChart'
import { WARD_LABELS } from './wardLabels'

export default function WardBoard({ engine, actor }: { engine: Engine; actor: Actor }) {
  const [admitBed, setAdmitBed] = useState<BedView | null>(null)
  const [chartAdmissionId, setChartAdmissionId] = useState<number | null>(null)

  // Re-read on every render (the store re-renders this tree after every
  // dispatch) so occupancy always reflects the live db, not a stale copy.
  const groups = bedGrid(engine.beds())
  const census = engine.census()

  function handleBedClick(bed: BedView): void {
    if (bed.occupied) {
      if (bed.admissionId !== undefined) setChartAdmissionId(bed.admissionId)
      return
    }
    setAdmitBed(bed)
  }

  return (
    <section className="ward-board">
      <p className="census-line">
        {census.bedsFree}/{census.bedsTotal} beds free · {census.active} active admissions
      </p>

      {groups.map((group) => (
        <div key={group.ward} className="ward-group">
          <h2>
            <span className="ward-code" aria-hidden="true">
              {group.ward.charAt(0)}
            </span>
            {WARD_LABELS[group.ward] ?? group.ward}
            <span className="ward-counts">
              <strong>{group.freeCount}</strong> free · <strong>{group.occupiedCount}</strong> occupied
            </span>
          </h2>
          <div className="bed-row">
            {group.beds.map((bed) => (
              <button
                key={bed.id}
                type="button"
                className={`bed-cell ${bed.occupied ? 'bed-cell--occupied' : 'bed-cell--free'}`}
                onClick={() => handleBedClick(bed)}
              >
                <strong className="bed-cell__label">{bed.label}</strong>
                <span className="bed-cell__who">{bed.occupied ? bed.patientName : 'Free'}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {admitBed && (
        <AdmitDialog engine={engine} actor={actor} bed={admitBed} onClose={() => setAdmitBed(null)} />
      )}
      {chartAdmissionId !== null && (
        <PatientChart
          engine={engine}
          actor={actor}
          admissionId={chartAdmissionId}
          onClose={() => setChartAdmissionId(null)}
        />
      )}
    </section>
  )
}
