import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import type { Engine, Actor } from '../../core/engine'
import { can } from '../../core/permissions'
import { store } from '../store'
import { formatDateTimeIST } from '../format'
import { DISPATCH_LOCATIONS } from '../../seed/names'
import { ROLE_LABELS } from '../labels'
import { roleToSwitchTo, switchRole, whoMay } from '../session'
import { Icon } from '../icons'

/** A side view of the van: drawn, not an image, so it takes the theme's colours. */
function Van({ out }: { out: boolean }) {
  return (
    <svg className={`van${out ? ' van--out' : ''}`} viewBox="0 0 160 76" aria-hidden="true">
      <path className="van__body" d="M8 58V22a8 8 0 0 1 8-8h80v44z" />
      <path className="van__cab" d="M96 14h22c4 0 7 2 9 5l13 17c2 3 4 6 4 10v12H96z" />
      <path className="van__window" d="M104 22h13c2 0 3 1 4 2l9 12h-26z" />
      <rect className="van__stripe" x="8" y="40" width="136" height="6" />
      <path className="van__cross" d="M42 22h8v8h8v8h-8v8h-8v-8h-8v-8h8z" />
      <rect className="van__light" x="62" y="8" width="18" height="6" rx="3" />
      <circle className="van__wheel" cx="36" cy="60" r="10" />
      <circle className="van__wheel" cx="118" cy="60" r="10" />
      <circle className="van__hub" cx="36" cy="60" r="4" />
      <circle className="van__hub" cx="118" cy="60" r="4" />
    </svg>
  )
}

export default function Ambulances({ engine, actor }: { engine: Engine; actor: Actor }) {
  const [formFor, setFormFor] = useState<number | null>(null)
  const [location, setLocation] = useState('')
  const [admissionId, setAdmissionId] = useState<number | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const listId = useId()

  // Re-read on every render, so a dispatch or a return shows at once.
  const ambulances = engine.ambulances()
  const inBeds = engine.admissionsActive()
  const canSend = can(actor.role, 'DISPATCH_AMBULANCE')
  const canReturn = can(actor.role, 'RETURN_AMBULANCE')
  const outCount = ambulances.filter((a) => a.openDispatch).length
  const other = roleToSwitchTo('DISPATCH_AMBULANCE', actor.role)

  function openForm(id: number): void {
    setFormFor(id)
    setLocation('')
    setAdmissionId('')
    setError(null)
    setFailure(null)
  }

  function send(e: FormEvent<HTMLFormElement>, ambulanceId: number): void {
    e.preventDefault()
    if (!location.trim()) {
      setError('Say where the ambulance is going.')
      return
    }
    setError(null)
    setFailure(null)
    try {
      store.dispatch((en, a) =>
        en.dispatchAmbulance(a, {
          ambulanceId,
          location: location.trim(),
          admissionId: admissionId === '' ? undefined : admissionId,
        }),
      )
      setFormFor(null)
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err))
    }
  }

  function bringBack(dispatchId: number): void {
    setFailure(null)
    try {
      store.dispatch((en, a) => en.returnAmbulance(a, { dispatchId }))
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className="page" aria-labelledby="amb-title">
      <header className="page-head">
        <h1 id="amb-title">Ambulances</h1>
        <p>
          Four ambulances, parked in the bay by the main entrance. Send one to a call and mark it back when it
          returns. The database will not let one ambulance go out twice at the same time.
        </p>
      </header>

      <p className="page-summary">
        <strong>{ambulances.length - outCount}</strong> on station, <strong>{outCount}</strong> out on a call.
      </p>

      {!canSend && (
        <div className="locked">
          <Icon name="lock" size={18} />
          <div>
            <p>
              As {ROLE_LABELS[actor.role].toLowerCase()} you can see the fleet, but only {whoMay('DISPATCH_AMBULANCE')}{' '}
              can send an ambulance out.
            </p>
            {other && (
              <button type="button" className="text-button" onClick={() => switchRole(other)}>
                Switch to {ROLE_LABELS[other].toLowerCase()}
              </button>
            )}
          </div>
        </div>
      )}

      {failure && (
        <p className="notice notice--bad" role="alert">
          <Icon name="cross" size={18} /> The engine refused: {failure}
        </p>
      )}

      <ul className="fleet">
        {ambulances.map((amb) => {
          const out = amb.openDispatch
          return (
            <li key={amb.id} className={`vehicle${out ? ' vehicle--out' : ''}`}>
              <Van out={out !== undefined} />
              <div className="vehicle__id">
                <span className="numberplate">{amb.plate}</span>
                <span className="vehicle__model">{amb.model}</span>
              </div>
              {out ? (
                <>
                  <p className="vehicle__status vehicle__status--out">
                    <span className="status-dot" aria-hidden="true" /> Out at {out.location}
                  </p>
                  <p className="vehicle__since">Since {formatDateTimeIST(out.dispatchedAt)}</p>
                  {canReturn && (
                    <button type="button" className="button button--block" onClick={() => bringBack(out.id)}>
                      Mark back on station
                    </button>
                  )}
                </>
              ) : (
                <>
                  <p className="vehicle__status vehicle__status--in">
                    <span className="status-dot" aria-hidden="true" /> On station
                  </p>
                  {canSend &&
                    (formFor === amb.id ? (
                      <form className="form" onSubmit={(e) => send(e, amb.id)} noValidate>
                        <label className={`field${error ? ' field--error' : ''}`}>
                          <span className="field__label">Where to</span>
                          <input value={location} onChange={(e) => setLocation(e.target.value)} list={listId} data-autofocus />
                          {error && <span className="field__error">{error}</span>}
                        </label>
                        <label className="field">
                          <span className="field__label">For a patient in a bed (optional)</span>
                          <select
                            value={admissionId}
                            onChange={(e) => setAdmissionId(e.target.value === '' ? '' : Number(e.target.value))}
                          >
                            <option value="">No one yet</option>
                            {inBeds.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.patientName}, {a.bedLabel}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="form__actions">
                          <button type="submit" className="button button--primary">
                            Send {amb.plate.replace('WD-AMB-', 'unit ')}
                          </button>
                          <button type="button" className="button button--ghost" onClick={() => setFormFor(null)}>
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button type="button" className="button button--block" onClick={() => openForm(amb.id)}>
                        Send to a call
                      </button>
                    ))}
                </>
              )}
            </li>
          )
        })}
      </ul>
      <datalist id={listId}>
        {DISPATCH_LOCATIONS.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
    </section>
  )
}
