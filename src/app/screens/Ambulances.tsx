import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Engine, Actor } from '../../core/engine'
import { can } from '../../core/permissions'
import { store } from '../store'
import { formatDateTimeIST } from '../format'

export default function Ambulances({ engine, actor }: { engine: Engine; actor: Actor }) {
  const [banner, setBanner] = useState<string | null>(null)
  const [dispatchFormFor, setDispatchFormFor] = useState<number | null>(null)
  const [location, setLocation] = useState('')
  const [admissionId, setAdmissionId] = useState<number | ''>('')
  const [fieldErrors, setFieldErrors] = useState<string[]>([])

  // Nav already hides this link without VIEW_CLINICAL; guard here too.
  if (!can(actor.role, 'VIEW_CLINICAL')) {
    return <p className="access-denied">Ambulances requires clinical access.</p>
  }

  // Re-read on every render so status/location reflect the live db right
  // after a dispatch/return dispatch.
  const ambulances = engine.ambulances()
  const activeAdmissions = engine.admissionsActive()
  const canDispatch = can(actor.role, 'DISPATCH_AMBULANCE')
  const canReturn = can(actor.role, 'RETURN_AMBULANCE')

  function openDispatchForm(ambulanceId: number): void {
    setBanner(null)
    setFieldErrors([])
    setLocation('')
    setAdmissionId('')
    setDispatchFormFor(ambulanceId)
  }

  function handleDispatch(evt: FormEvent<HTMLFormElement>, ambulanceId: number): void {
    evt.preventDefault()
    const loc = location.trim()
    if (!loc) {
      setFieldErrors(['location is required'])
      return
    }
    setFieldErrors([])
    setBanner(null)
    try {
      store.dispatch((e, a) =>
        e.dispatchAmbulance(a, {
          ambulanceId,
          location: loc,
          admissionId: admissionId === '' ? undefined : admissionId,
        }),
      )
      setDispatchFormFor(null)
      setLocation('')
      setAdmissionId('')
    } catch (err) {
      setBanner(err instanceof Error ? err.message : String(err))
    }
  }

  function handleReturn(dispatchId: number): void {
    setBanner(null)
    try {
      store.dispatch((e, a) => e.returnAmbulance(a, { dispatchId }))
    } catch (err) {
      setBanner(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className="ambulances">
      {banner !== null && (
        <p className="error-banner" role="alert">
          {banner}
          <button type="button" onClick={() => setBanner(null)}>
            Dismiss
          </button>
        </p>
      )}

      <div className="ambulance-grid">
        {ambulances.map((amb) => (
          <div
            key={amb.id}
            className={`ambulance-card ${amb.openDispatch ? 'ambulance-card--dispatched' : 'ambulance-card--free'}`}
          >
            <h3>{amb.plate}</h3>
            <p className="ambulance-model">{amb.model}</p>

            {amb.openDispatch ? (
              <>
                <p className="ambulance-status ambulance-status--out">Dispatched to {amb.openDispatch.location}</p>
                <p className="ambulance-since">Since {formatDateTimeIST(amb.openDispatch.dispatchedAt)}</p>
                {canReturn && (
                  <button type="button" onClick={() => handleReturn(amb.openDispatch!.id)}>
                    Return
                  </button>
                )}
              </>
            ) : (
              <>
                <p className="ambulance-status ambulance-status--free">On station</p>
                {canDispatch &&
                  (dispatchFormFor === amb.id ? (
                    <form className="dispatch-form" onSubmit={(evt) => handleDispatch(evt, amb.id)}>
                      <label>
                        Location
                        <input value={location} onChange={(e) => setLocation(e.target.value)} />
                      </label>
                      <label>
                        Link to admission (optional)
                        <select
                          value={admissionId}
                          onChange={(e) => setAdmissionId(e.target.value === '' ? '' : Number(e.target.value))}
                        >
                          <option value="">None</option>
                          {activeAdmissions.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.patientName} · {a.bedLabel}
                            </option>
                          ))}
                        </select>
                      </label>
                      {fieldErrors.length > 0 && (
                        <ul className="field-errors">
                          {fieldErrors.map((msg) => (
                            <li key={msg}>{msg}</li>
                          ))}
                        </ul>
                      )}
                      <button type="submit">Dispatch</button>
                      <button type="button" onClick={() => setDispatchFormFor(null)}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <button type="button" onClick={() => openDispatchForm(amb.id)}>
                      Dispatch
                    </button>
                  ))}
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
