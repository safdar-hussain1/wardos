import { useState } from 'react'
import type { Engine, Actor, BedView } from '../../core/engine'
import { bedGrid } from '../viewmodels'
import AdmitDialog from './AdmitDialog'
import PatientChart from './PatientChart'

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
            {group.ward}
            <span className="ward-counts">
              {group.freeCount} free / {group.occupiedCount} occupied
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
                <strong>{bed.label}</strong>
                <span>{bed.occupied ? bed.patientName : 'Free'}</span>
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
