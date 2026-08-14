import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Engine, Actor } from '../../core/engine'
import type { ChargeKind } from '../../core/billing'
import { rupees } from '../../core/money'
import { store } from '../store'
import { formatINR, formatDateTimeIST } from '../format'
import { chartVm } from '../viewmodels'
import InvoiceDetail from './InvoiceDetail'

const CHARGE_KINDS: ChargeKind[] = ['PROCEDURE', 'PHARMACY', 'CONSULTATION', 'TRANSPORT']

export default function PatientChart({
  engine,
  actor,
  admissionId,
  onClose,
}: {
  engine: Engine
  actor: Actor
  admissionId: number
  onClose: () => void
}) {
  const [banner, setBanner] = useState<string | null>(null)
  const [chargeKind, setChargeKind] = useState<ChargeKind>('PROCEDURE')
  const [chargeDesc, setChargeDesc] = useState('')
  const [chargeAmount, setChargeAmount] = useState('')
  const [chargeErrors, setChargeErrors] = useState<string[]>([])
  const [showTransfer, setShowTransfer] = useState(false)
  const [transferBedId, setTransferBedId] = useState<number | null>(null)

  // Re-derived on every render so it reflects the live db right after a dispatch.
  const vm = chartVm(engine, actor, admissionId)

  function runDispatch(fn: (e: Engine, a: Actor) => void): void {
    setBanner(null)
    try {
      store.dispatch(fn)
    } catch (err) {
      setBanner(err instanceof Error ? err.message : String(err))
    }
  }

  function handleAddCharge(evt: FormEvent<HTMLFormElement>): void {
    evt.preventDefault()
    const problems: string[] = []
    const desc = chargeDesc.trim()
    if (!desc) problems.push('description is required')

    let amountPaise = 0
    const amountNum = Number(chargeAmount)
    if (chargeAmount.trim() === '' || !Number.isFinite(amountNum) || amountNum <= 0) {
      problems.push('amount must be a positive number of rupees')
    } else {
      try {
        amountPaise = rupees(amountNum)
      } catch {
        problems.push('amount must be precise to the paise (at most 2 decimal places)')
      }
    }

    setChargeErrors(problems)
    if (problems.length > 0) return

    runDispatch((e, a) => {
      e.addCharge(a, { admissionId, kind: chargeKind, description: desc, amountPaise })
    })
    setChargeDesc('')
    setChargeAmount('')
  }

  function handleTransfer(): void {
    if (transferBedId === null) return
    const toBedId = transferBedId
    runDispatch((e, a) => {
      e.transfer(a, { admissionId, toBedId })
    })
    setShowTransfer(false)
    setTransferBedId(null)
  }

  function handleDischarge(): void {
    runDispatch((e, a) => {
      e.discharge(a, { admissionId })
    })
  }

  if (!vm.found) {
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true">
        <div className="modal">
          <p>Admission not found.</p>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    )
  }

  const freeBeds = engine.beds().filter((b) => !b.occupied)

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Patient chart">
      <div className="modal patient-chart">
        <header className="modal-header">
          <h2>
            {vm.patientName} · {vm.mrn}
          </h2>
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

        {vm.isDischarged && vm.invoice ? (
          <section className="invoice-modal">
            <h3>Invoice</h3>
            <InvoiceDetail invoice={vm.invoice} issuedAt={vm.invoice.issuedAt} frozen />
          </section>
        ) : (
          <>
            <section className="admission-details">
              <p>Bed: {vm.bedLabel}</p>
              <p>Diagnosis: {vm.diagnosis}</p>
              <p>Deposit: {vm.depositPaise !== undefined ? formatINR(vm.depositPaise) : '—'}</p>
              <p>Admitted: {vm.admittedAt !== undefined ? formatDateTimeIST(vm.admittedAt) : '—'}</p>
            </section>

            <section className="charges">
              <h3>Charges</h3>
              {vm.charges.length === 0 ? (
                <p>No charges yet.</p>
              ) : (
                <ul className="charge-list">
                  {vm.charges.map((line, i) => (
                    <li key={i}>
                      {line.kind} — {line.description}: {formatINR(line.amountPaise)}
                    </li>
                  ))}
                </ul>
              )}
              {vm.preview && (
                <p className="live-preview">
                  Live preview ({vm.preview.nights} night{vm.preview.nights === 1 ? '' : 's'}):{' '}
                  {vm.preview.isRefund
                    ? `refund due ${formatINR(vm.preview.refundPaise)}`
                    : `balance ${formatINR(vm.preview.balancePaise)}`}
                </p>
              )}
            </section>

            {vm.permittedActions.addCharge && (
              <form onSubmit={handleAddCharge} className="add-charge-form">
                <h3>Add charge</h3>
                <label>
                  Kind
                  <select value={chargeKind} onChange={(e) => setChargeKind(e.target.value as ChargeKind)}>
                    {CHARGE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Description
                  <input value={chargeDesc} onChange={(e) => setChargeDesc(e.target.value)} />
                </label>
                <label>
                  Amount (₹)
                  <input
                    inputMode="decimal"
                    value={chargeAmount}
                    onChange={(e) => setChargeAmount(e.target.value)}
                  />
                </label>
                {chargeErrors.length > 0 && (
                  <ul className="field-errors">
                    {chargeErrors.map((msg) => (
                      <li key={msg}>{msg}</li>
                    ))}
                  </ul>
                )}
                <button type="submit">Add charge</button>
              </form>
            )}

            <section className="chart-actions">
              {vm.permittedActions.transfer && (
                <div className="transfer-block">
                  <button type="button" onClick={() => setShowTransfer((s) => !s)}>
                    Transfer
                  </button>
                  {showTransfer && (
                    <div className="transfer-picker">
                      <select
                        value={transferBedId ?? ''}
                        onChange={(e) => setTransferBedId(Number(e.target.value))}
                      >
                        <option value="" disabled>
                          Select a free bed
                        </option>
                        {freeBeds.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.label} ({b.ward})
                          </option>
                        ))}
                      </select>
                      <button type="button" onClick={handleTransfer} disabled={transferBedId === null}>
                        Confirm transfer
                      </button>
                    </div>
                  )}
                </div>
              )}
              {vm.permittedActions.discharge && (
                <button type="button" onClick={handleDischarge}>
                  Discharge
                </button>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
