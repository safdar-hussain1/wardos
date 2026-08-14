import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Engine, Actor, BedView, PatientRow } from '../../core/engine'
import { can } from '../../core/permissions'
import { rupees } from '../../core/money'
import { store } from '../store'

type Gender = 'F' | 'M' | 'O'

export default function AdmitDialog({
  engine,
  actor,
  bed,
  onClose,
}: {
  engine: Engine
  actor: Actor
  bed: BedView
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null)
  const [showRegister, setShowRegister] = useState(false)
  const [name, setName] = useState('')
  const [gender, setGender] = useState<Gender>('F')
  const [dob, setDob] = useState('')
  const [phone, setPhone] = useState('')
  const [idLast4, setIdLast4] = useState('')
  const [diagnosis, setDiagnosis] = useState('')
  const [depositRupees, setDepositRupees] = useState('0')
  const [fieldErrors, setFieldErrors] = useState<string[]>([])
  const [banner, setBanner] = useState<string | null>(null)

  const canAdmit = can(actor.role, 'ADMIT')
  const canRegister = can(actor.role, 'REGISTER_PATIENT')

  const results: PatientRow[] = query.trim() ? engine.patients(query.trim()) : []

  function validate(): { diagnosisTrim: string; depositPaise: number } | undefined {
    const problems: string[] = []
    const diagnosisTrim = diagnosis.trim()
    if (!diagnosisTrim) problems.push('diagnosis is required')

    if (!showRegister && selectedPatientId === null) {
      problems.push('select a patient, or register a new one')
    }
    if (showRegister) {
      if (!name.trim()) problems.push('name is required')
      if (!dob) problems.push('date of birth is required')
      if (!phone.trim()) problems.push('phone is required')
      if (!/^\d{4}$/.test(idLast4)) problems.push('ID last 4 must be exactly 4 digits')
    }

    let depositPaise = 0
    const depositNum = Number(depositRupees)
    if (depositRupees.trim() === '' || !Number.isFinite(depositNum) || depositNum < 0) {
      problems.push('deposit must be a non-negative number of rupees')
    } else {
      try {
        depositPaise = rupees(depositNum)
      } catch {
        problems.push('deposit must be precise to the paise (at most 2 decimal places)')
      }
    }

    setFieldErrors(problems)
    if (problems.length > 0) return undefined
    return { diagnosisTrim, depositPaise }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault()
    const validated = validate()
    if (!validated) return

    setBanner(null)
    try {
      store.dispatch((e, a) => {
        let patientId = selectedPatientId
        if (showRegister) {
          patientId = e.registerPatient(a, {
            name: name.trim(),
            gender,
            dobIso: dob,
            phone: phone.trim(),
            idLast4,
          })
        }
        if (patientId === null) {
          throw new Error('no patient selected')
        }
        e.admit(a, {
          patientId,
          bedId: bed.id,
          diagnosis: validated.diagnosisTrim,
          depositPaise: validated.depositPaise,
        })
      })
      onClose()
    } catch (err) {
      setBanner(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`Admit to ${bed.label}`}>
      <div className="modal">
        <header className="modal-header">
          <h2>Admit to {bed.label}</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {banner !== null && (
          <p className="error-banner" role="alert">
            {banner}
            <button type="button" onClick={() => setBanner(null)}>
              Dismiss
            </button>
          </p>
        )}

        <form onSubmit={handleSubmit} className="admit-form">
          {!showRegister && (
            <>
              <label>
                Search patient (name or MRN)
                <input value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
              <ul className="patient-results">
                {results.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={selectedPatientId === p.id ? 'patient-result--selected' : ''}
                      onClick={() => setSelectedPatientId(p.id)}
                    >
                      {p.name} · {p.mrn}
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" disabled={!canRegister} onClick={() => setShowRegister(true)}>
                Register new patient
              </button>
            </>
          )}

          {showRegister && (
            <fieldset>
              <legend>New patient</legend>
              <label>
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label>
                Gender
                <select value={gender} onChange={(e) => setGender(e.target.value as Gender)}>
                  <option value="F">F</option>
                  <option value="M">M</option>
                  <option value="O">O</option>
                </select>
              </label>
              <label>
                Date of birth
                <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
              </label>
              <label>
                Phone
                <input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </label>
              <label>
                ID last 4
                <input value={idLast4} onChange={(e) => setIdLast4(e.target.value)} maxLength={4} />
              </label>
              <button type="button" onClick={() => setShowRegister(false)}>
                Back to search
              </button>
            </fieldset>
          )}

          <label>
            Diagnosis
            <input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
          </label>
          <label>
            Deposit (₹)
            <input
              inputMode="decimal"
              value={depositRupees}
              onChange={(e) => setDepositRupees(e.target.value)}
            />
          </label>

          {fieldErrors.length > 0 && (
            <ul className="field-errors">
              {fieldErrors.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          )}

          <button type="submit" disabled={!canAdmit}>
            Admit
          </button>
        </form>
      </div>
    </div>
  )
}
