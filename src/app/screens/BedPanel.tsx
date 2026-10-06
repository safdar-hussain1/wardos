import { useId, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { Engine, Actor, BedView, PatientRow } from '../../core/engine'
import type { ChargeKind, ComputedInvoice } from '../../core/billing'
import type { Permission, Role } from '../../core/permissions'
import { can } from '../../core/permissions'
import { rupees } from '../../core/money'
import { store } from '../store'
import { chartVm, samplePatient } from '../viewmodels'
import { formatINR, formatDateIST } from '../format'
import { CHARGE_KIND_LABELS, ROLE_LABELS, WARD_LABELS, WARD_TOKENS } from '../labels'
import { roleToSwitchTo, switchRole, whoMay } from '../session'
import { nightsBetween } from '../../core/billing'
import {
  CONSULTATION_DESCRIPTIONS,
  DIAGNOSES,
  PHARMACY_DESCRIPTIONS,
  PROCEDURE_DESCRIPTIONS,
  TRANSPORT_DESCRIPTIONS,
} from '../../seed/names'
import InvoiceDetail from './InvoiceDetail'
import { Icon } from '../icons'

const CHARGE_KINDS: ChargeKind[] = ['PROCEDURE', 'PHARMACY', 'CONSULTATION', 'TRANSPORT']
const CHARGE_SUGGESTIONS: Record<ChargeKind, readonly string[]> = {
  PROCEDURE: PROCEDURE_DESCRIPTIONS,
  PHARMACY: PHARMACY_DESCRIPTIONS,
  CONSULTATION: CONSULTATION_DESCRIPTIONS,
  TRANSPORT: TRANSPORT_DESCRIPTIONS,
}

/** Parses a rupee amount typed by a person into whole paise, or explains what is wrong with it. */
export function parseRupees(raw: string, { allowZero }: { allowZero: boolean }): { paise: number } | { error: string } {
  const text = raw.trim().replace(/,/g, '')
  if (text === '') return { error: 'Enter an amount in rupees.' }
  const value = Number(text)
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    return { error: allowZero ? 'Enter zero or more rupees.' : 'Enter more than zero rupees.' }
  }
  try {
    return { paise: rupees(value) }
  } catch {
    return { error: 'Use at most two decimal places (paise).' }
  }
}

export function WardPlate({ ward, label }: { ward: string; label: string }) {
  return <span className={`bedplate bedplate--${WARD_TOKENS[ward] ?? 'general'}`}>{label}</span>
}

/** Explains who may do something, with a one-click switch to a role that can. */
function Locked({ permission, actor, children }: { permission: Permission; actor: Actor; children: ReactNode }) {
  const other: Role | undefined = roleToSwitchTo(permission, actor.role)
  return (
    <div className="locked">
      <Icon name="lock" size={18} />
      <div>
        <p>
          {children} As {ROLE_LABELS[actor.role].toLowerCase()} you can see this, but only {whoMay(permission)} can do it.
        </p>
        {other && (
          <button type="button" className="text-button" onClick={() => switchRole(other)}>
            Switch to {ROLE_LABELS[other].toLowerCase()}
          </button>
        )}
      </div>
    </div>
  )
}

function Field({ label, error, children, hint }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className={`field${error ? ' field--error' : ''}`}>
      <span className="field__label">{label}</span>
      {children}
      {hint && !error && <span className="field__hint">{hint}</span>}
      {error && <span className="field__error">{error}</span>}
    </label>
  )
}

// ---------------------------------------------------------------------------
// Admit
// ---------------------------------------------------------------------------

type PatientMode = 'new' | 'existing'

export function AdmitPanel({
  engine,
  actor,
  bed,
  freeBeds,
  onPickBed,
  onAdmitted,
}: {
  engine: Engine
  actor: Actor
  bed: BedView
  freeBeds: BedView[]
  onPickBed: (bedId: number) => void
  onAdmitted: (admissionId: number, patientName: string) => void
}) {
  const formId = useId()
  const canAdmit = can(actor.role, 'ADMIT')
  const canRegister = can(actor.role, 'REGISTER_PATIENT')
  const [mode, setMode] = useState<PatientMode>('new')
  const [query, setQuery] = useState('')
  const [existingId, setExistingId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [gender, setGender] = useState<'F' | 'M' | 'O'>('F')
  const [dob, setDob] = useState('')
  const [phone, setPhone] = useState('')
  const [idLast4, setIdLast4] = useState('')
  const [diagnosis, setDiagnosis] = useState('')
  // Until the visitor types a deposit, suggest two nights in whichever bed is picked.
  const [depositInput, setDepositInput] = useState<string | null>(null)
  const deposit = depositInput ?? String((bed.ratePaise * 2) / 100)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)

  const admittedIds = new Set(engine.admissionsActive().map((a) => a.patientId))
  const matches: PatientRow[] = query.trim()
    ? engine
        .patients(query.trim())
        .filter((p) => !admittedIds.has(p.id))
        .slice(0, 6)
    : []

  function fillSample(): void {
    const sample = samplePatient(engine.census().patients + 1)
    setMode('new')
    setName(sample.name)
    setGender(sample.gender)
    setDob(sample.dobIso)
    setPhone(sample.phone)
    setIdLast4(sample.idLast4)
    setDiagnosis(sample.diagnosis)
    setErrors({})
  }

  function submit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault()
    const problems: Record<string, string> = {}
    if (mode === 'new') {
      if (!name.trim()) problems.name = 'Enter the patient’s name.'
      if (!dob) problems.dob = 'Enter a date of birth.'
      if (!phone.trim()) problems.phone = 'Enter a phone number.'
      if (!/^\d{4}$/.test(idLast4)) problems.idLast4 = 'Enter exactly four digits.'
    } else if (existingId === null) {
      problems.existing = 'Pick a patient from the search results.'
    }
    if (!diagnosis.trim()) problems.diagnosis = 'Enter the reason for admission.'
    const money = parseRupees(deposit, { allowZero: true })
    if ('error' in money) problems.deposit = money.error
    setErrors(problems)
    if (Object.keys(problems).length > 0 || 'error' in money) return

    setFailure(null)
    try {
      let patientName = ''
      const admissionId = store.dispatch((en, a) => {
        let patientId = existingId
        if (mode === 'new') {
          patientId = en.registerPatient(a, { name: name.trim(), gender, dobIso: dob, phone: phone.trim(), idLast4 })
          patientName = name.trim()
        } else {
          patientName = en.patients().find((p) => p.id === existingId)?.name ?? ''
        }
        if (patientId === null) throw new Error('no patient selected')
        return en.admit(a, { patientId, bedId: bed.id, diagnosis: diagnosis.trim(), depositPaise: money.paise })
      })
      onAdmitted(admissionId, patientName)
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err))
    }
  }

  const wardBeds = (ward: string) => freeBeds.filter((b) => b.ward === ward)

  return (
    <div className="panel">
      <p className="panel__rate">
        This bed costs <strong>{formatINR(bed.ratePaise)}</strong> a night.
      </p>

      {!canAdmit && (
        <Locked permission="ADMIT" actor={actor}>
          Admitting a patient changes who is in a bed.
        </Locked>
      )}

      <form id={formId} className="form" onSubmit={submit} noValidate>
        <Field label="Bed">
          <select value={bed.id} onChange={(e) => onPickBed(Number(e.target.value))} disabled={!canAdmit}>
            {['GENERAL', 'TWIN', 'PRIVATE', 'ICU'].map((ward) =>
              wardBeds(ward).length === 0 ? null : (
                <optgroup key={ward} label={WARD_LABELS[ward]}>
                  {wardBeds(ward).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}, {formatINR(b.ratePaise)} a night
                    </option>
                  ))}
                </optgroup>
              ),
            )}
          </select>
        </Field>

        <fieldset className="form__group">
          <legend>Patient</legend>
          <div className="segmented" role="radiogroup" aria-label="Who is being admitted">
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'new'}
              className={mode === 'new' ? 'is-on' : ''}
              onClick={() => setMode('new')}
              disabled={!canAdmit}
            >
              New patient
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'existing'}
              className={mode === 'existing' ? 'is-on' : ''}
              onClick={() => setMode('existing')}
              disabled={!canAdmit}
            >
              Returning patient
            </button>
          </div>

          {mode === 'new' ? (
            <>
              {!canRegister && canAdmit && (
                <Locked permission="REGISTER_PATIENT" actor={actor}>
                  Registering a new patient creates their record.
                </Locked>
              )}
              <button
                type="button"
                className="text-button text-button--start"
                onClick={fillSample}
                disabled={!canAdmit || !canRegister}
              >
                Fill in a sample patient
              </button>
              <Field label="Full name" error={errors.name}>
                <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" disabled={!canAdmit || !canRegister} />
              </Field>
              <div className="form__row">
                <Field label="Sex">
                  <select value={gender} onChange={(e) => setGender(e.target.value as 'F' | 'M' | 'O')} disabled={!canAdmit || !canRegister}>
                    <option value="F">Female</option>
                    <option value="M">Male</option>
                    <option value="O">Other</option>
                  </select>
                </Field>
                <Field label="Date of birth" error={errors.dob}>
                  <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} disabled={!canAdmit || !canRegister} />
                </Field>
              </div>
              <div className="form__row">
                <Field label="Phone" error={errors.phone}>
                  <input value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} disabled={!canAdmit || !canRegister} />
                </Field>
                <Field label="ID, last 4 digits" error={errors.idLast4}>
                  <input
                    value={idLast4}
                    inputMode="numeric"
                    maxLength={4}
                    onChange={(e) => setIdLast4(e.target.value)}
                    disabled={!canAdmit || !canRegister}
                  />
                </Field>
              </div>
            </>
          ) : (
            <>
              <Field label="Search by name or record number" error={errors.existing}>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Rao or WH-0012" disabled={!canAdmit} />
              </Field>
              {query.trim() !== '' && (
                <ul className="picklist">
                  {matches.length === 0 && <li className="picklist__empty">No patient out of bed matches that.</li>}
                  {matches.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className={existingId === p.id ? 'is-on' : ''}
                        aria-pressed={existingId === p.id}
                        onClick={() => setExistingId(p.id)}
                      >
                        <strong>{p.name}</strong>
                        <span>{p.mrn}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </fieldset>

        <Field label="Reason for admission" error={errors.diagnosis}>
          <input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} list={`${formId}-dx`} disabled={!canAdmit} />
        </Field>
        <datalist id={`${formId}-dx`}>
          {DIAGNOSES.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
        <Field label="Deposit taken now (₹)" error={errors.deposit} hint="Suggested: two nights in this bed.">
          <input value={deposit} inputMode="decimal" onChange={(e) => setDepositInput(e.target.value)} disabled={!canAdmit} />
        </Field>

        {failure && (
          <p className="notice notice--bad" role="alert">
            <Icon name="cross" size={18} /> The engine refused: {failure}
          </p>
        )}

        <button type="submit" className="button button--primary button--block" disabled={!canAdmit}>
          Admit to {bed.label}
        </button>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chart: one patient in a bed
// ---------------------------------------------------------------------------

function ActionBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="action">
      <h3 className="action__title">{title}</h3>
      {children}
    </section>
  )
}

export function ChartPanel({
  engine,
  actor,
  admissionId,
  anchorIso,
  onDischarged,
  onMoved,
}: {
  engine: Engine
  actor: Actor
  admissionId: number
  anchorIso: string
  onDischarged: (invoice: ComputedInvoice, patientName: string) => void
  onMoved: (bedId: number) => void
}) {
  const vm = chartVm(engine, actor, admissionId)
  const [kind, setKind] = useState<ChargeKind>('PROCEDURE')
  const [desc, setDesc] = useState('')
  const [amount, setAmount] = useState('')
  const [deposit, setDeposit] = useState('')
  const [moveTo, setMoveTo] = useState<number | ''>('')
  const [confirming, setConfirming] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [done, setDone] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const listId = useId()

  if (!vm.found) return <p className="notice">This stay is no longer on the ward.</p>

  if (vm.isDischarged && vm.invoice) {
    return (
      <div className="panel">
        <InvoiceDetail invoice={vm.invoice} issuedAt={vm.invoice.issuedAt} final />
      </div>
    )
  }

  const bed = engine.beds().find((b) => b.admissionId === admissionId)
  const freeBeds = engine.beds().filter((b) => !b.occupied)
  const nights = vm.admittedAt ? nightsBetween(vm.admittedAt, anchorIso) : undefined

  function run(label: string, fn: (e: Engine, a: Actor) => void): boolean {
    setFailure(null)
    setDone(null)
    try {
      store.dispatch(fn)
      setDone(label)
      return true
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err))
      return false
    }
  }

  function addCharge(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault()
    const problems: Record<string, string> = {}
    if (!desc.trim()) problems.desc = 'Say what the charge is for.'
    const money = parseRupees(amount, { allowZero: false })
    if ('error' in money) problems.amount = money.error
    setErrors(problems)
    if (Object.keys(problems).length > 0 || 'error' in money) return
    if (run('Charge added. The running bill below is updated.', (en, a) => {
      en.addCharge(a, { admissionId, kind, description: desc.trim(), amountPaise: money.paise })
    })) {
      setDesc('')
      setAmount('')
    }
  }

  function takeDeposit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault()
    const money = parseRupees(deposit, { allowZero: false })
    if ('error' in money) {
      setErrors({ deposit: money.error })
      return
    }
    setErrors({})
    if (run(`Deposit of ${formatINR(money.paise)} recorded.`, (en, a) => en.recordDeposit(a, { admissionId, amountPaise: money.paise }))) {
      setDeposit('')
    }
  }

  function move(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault()
    if (moveTo === '') {
      setErrors({ move: 'Pick a free bed.' })
      return
    }
    setErrors({})
    const target = moveTo
    if (run('Moved. The floor plan shows the new bed.', (en, a) => en.transfer(a, { admissionId, toBedId: target }))) {
      setMoveTo('')
      onMoved(target)
    }
  }

  function discharge(): void {
    setFailure(null)
    try {
      const invoice = store.dispatch((en, a) => en.discharge(a, { admissionId }))
      onDischarged(invoice, vm.patientName ?? '')
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err))
    }
    setConfirming(false)
  }

  return (
    <div className="panel">
      <dl className="facts">
        <div>
          <dt>Reason</dt>
          <dd>{vm.diagnosis}</dd>
        </div>
        <div>
          <dt>Record</dt>
          <dd>{vm.mrn}</dd>
        </div>
        <div>
          <dt>In since</dt>
          <dd>{vm.admittedAt ? formatDateIST(vm.admittedAt) : 'Unknown'}</dd>
        </div>
        <div>
          <dt>Nights so far</dt>
          <dd>{nights ?? 'Unknown'}</dd>
        </div>
      </dl>

      {vm.preview && <InvoiceDetail invoice={vm.preview} />}

      {done && (
        <p className="notice notice--ok" role="status">
          <Icon name="check" size={18} /> {done}
        </p>
      )}
      {failure && (
        <p className="notice notice--bad" role="alert">
          <Icon name="cross" size={18} /> The engine refused: {failure}
        </p>
      )}

      <ActionBlock title="Add a charge">
        {vm.permittedActions.addCharge ? (
          <form className="form" onSubmit={addCharge} noValidate>
            <div className="form__row">
              <Field label="Kind">
                <select value={kind} onChange={(e) => setKind(e.target.value as ChargeKind)}>
                  {CHARGE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {CHARGE_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Amount (₹)" error={errors.amount}>
                <input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} />
              </Field>
            </div>
            <Field label="What for" error={errors.desc}>
              <input value={desc} onChange={(e) => setDesc(e.target.value)} list={listId} />
            </Field>
            <datalist id={listId}>
              {CHARGE_SUGGESTIONS[kind].map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
            <button type="submit" className="button">
              Add charge
            </button>
          </form>
        ) : (
          <Locked permission="ADD_CHARGE" actor={actor}>
            Charges go on the patient’s bill.
          </Locked>
        )}
      </ActionBlock>

      <ActionBlock title="Take a deposit">
        {vm.permittedActions.recordDeposit ? (
          <form className="form form--inline" onSubmit={takeDeposit} noValidate>
            <Field label="Amount (₹)" error={errors.deposit}>
              <input value={deposit} inputMode="decimal" onChange={(e) => setDeposit(e.target.value)} />
            </Field>
            <button type="submit" className="button">
              Record deposit
            </button>
          </form>
        ) : (
          <Locked permission="RECORD_DEPOSIT" actor={actor}>
            A deposit is money taken against the bill.
          </Locked>
        )}
      </ActionBlock>

      <ActionBlock title="Move to another bed">
        {vm.permittedActions.transfer ? (
          <form className="form form--inline" onSubmit={move} noValidate>
            <Field label="Free bed" error={errors.move}>
              <select value={moveTo} onChange={(e) => setMoveTo(e.target.value === '' ? '' : Number(e.target.value))}>
                <option value="">Choose a bed</option>
                {['GENERAL', 'TWIN', 'PRIVATE', 'ICU'].map((ward) => {
                  const beds = freeBeds.filter((b) => b.ward === ward)
                  return beds.length === 0 ? null : (
                    <optgroup key={ward} label={WARD_LABELS[ward]}>
                      {beds.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.label}, {formatINR(b.ratePaise)} a night
                        </option>
                      ))}
                    </optgroup>
                  )
                })}
              </select>
            </Field>
            <button type="submit" className="button">
              Move patient
            </button>
          </form>
        ) : (
          <Locked permission="TRANSFER" actor={actor}>
            Moving a patient changes two beds at once.
          </Locked>
        )}
      </ActionBlock>

      <ActionBlock title="Discharge">
        {vm.permittedActions.discharge ? (
          confirming ? (
            <div className="confirm">
              <p>
                Discharge {vm.patientName}? The bill becomes final and {bed?.label ?? 'the bed'} is free again.
              </p>
              <div className="confirm__actions">
                <button type="button" className="button button--danger" onClick={discharge} data-autofocus>
                  Discharge and print the bill
                </button>
                <button type="button" className="button button--ghost" onClick={() => setConfirming(false)}>
                  Keep them in
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="button button--primary" onClick={() => setConfirming(true)}>
              Discharge {vm.patientName?.split(' ')[0] ?? 'patient'}
            </button>
          )
        ) : (
          <Locked permission="DISCHARGE" actor={actor}>
            Discharging ends the stay and issues the final bill.
          </Locked>
        )}
      </ActionBlock>
    </div>
  )
}
