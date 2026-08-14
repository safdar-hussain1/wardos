import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Engine, Actor } from '../../core/engine'
import { can } from '../../core/permissions'
import { addP, rupees } from '../../core/money'
import { store } from '../store'
import { formatINR } from '../format'
import { billingVm } from '../viewmodels'
import type { BillingActiveRow, BillingDischargedRow } from '../viewmodels'
import InvoiceDetail from './InvoiceDetail'

type Selected = { kind: 'active'; row: BillingActiveRow } | { kind: 'discharged'; row: BillingDischargedRow }

export default function BillingDesk({ engine, actor }: { engine: Engine; actor: Actor }) {
  const [banner, setBanner] = useState<string | null>(null)
  const [selected, setSelected] = useState<Selected | null>(null)
  const [depositAmounts, setDepositAmounts] = useState<Record<number, string>>({})
  const [depositErrors, setDepositErrors] = useState<Record<number, string>>({})

  // Nav already hides this link without VIEW_BILLING; guard here too.
  if (!can(actor.role, 'VIEW_BILLING')) {
    return <p className="access-denied">Billing desk requires billing access.</p>
  }

  // Re-read on every render so both sections reflect the live db right
  // after a deposit is recorded or an admission is discharged elsewhere.
  const vm = billingVm(engine, actor)

  function handleRecordDeposit(evt: FormEvent<HTMLFormElement>, admissionId: number): void {
    evt.preventDefault()
    const raw = depositAmounts[admissionId] ?? ''
    const amountNum = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(amountNum) || amountNum <= 0) {
      setDepositErrors((prev) => ({ ...prev, [admissionId]: 'amount must be a positive number of rupees' }))
      return
    }
    let amountPaise: number
    try {
      amountPaise = rupees(amountNum)
    } catch {
      setDepositErrors((prev) => ({
        ...prev,
        [admissionId]: 'amount must be precise to the paise (at most 2 decimal places)',
      }))
      return
    }
    setDepositErrors((prev) => {
      const next = { ...prev }
      delete next[admissionId]
      return next
    })
    setBanner(null)
    try {
      store.dispatch((e, a) => e.recordDeposit(a, { admissionId, amountPaise }))
      setDepositAmounts((prev) => ({ ...prev, [admissionId]: '' }))
    } catch (err) {
      setBanner(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className="billing-desk">
      {banner !== null && (
        <p className="error-banner" role="alert">
          {banner}
          <button type="button" onClick={() => setBanner(null)}>
            Dismiss
          </button>
        </p>
      )}

      <section className="billing-active" aria-label="Active admissions">
        <h2>Active admissions</h2>
        {vm.active.length === 0 ? (
          <p>No active admissions.</p>
        ) : (
          <table className="billing-table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Bed</th>
                <th>Nights so far</th>
                <th>Running total</th>
                <th>Deposit</th>
                <th>Projected</th>
                {vm.permittedActions.recordDeposit && <th>Record deposit</th>}
              </tr>
            </thead>
            <tbody>
              {vm.active.map((row) => (
                <tr key={row.admissionId}>
                  <td>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => setSelected({ kind: 'active', row })}
                    >
                      {row.patientName} · {row.mrn}
                    </button>
                  </td>
                  <td>{row.bedLabel}</td>
                  <td>{row.preview.nights}</td>
                  <td>{formatINR(addP(row.preview.roomTotalPaise, row.preview.extrasTotalPaise))}</td>
                  <td>{formatINR(row.preview.depositPaise)}</td>
                  <td className={row.preview.isRefund ? 'refund-due' : 'balance-due'}>
                    {row.preview.isRefund
                      ? `Refund ${formatINR(row.preview.refundPaise)}`
                      : `Balance ${formatINR(row.preview.balancePaise)}`}
                  </td>
                  {vm.permittedActions.recordDeposit && (
                    <td>
                      <form
                        className="inline-deposit-form"
                        onSubmit={(evt) => handleRecordDeposit(evt, row.admissionId)}
                      >
                        <input
                          inputMode="decimal"
                          placeholder="₹ amount"
                          value={depositAmounts[row.admissionId] ?? ''}
                          onChange={(e) =>
                            setDepositAmounts((prev) => ({ ...prev, [row.admissionId]: e.target.value }))
                          }
                        />
                        <button type="submit">Record</button>
                      </form>
                      {depositErrors[row.admissionId] !== undefined && (
                        <p className="field-errors">{depositErrors[row.admissionId]}</p>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="billing-discharged" aria-label="Discharged invoices">
        <h2>Discharged invoices</h2>
        {vm.discharged.length === 0 ? (
          <p>No discharged invoices yet.</p>
        ) : (
          <table className="billing-table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Bed</th>
                <th>Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {vm.discharged.map((row) => (
                <tr key={row.admissionId}>
                  <td>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => setSelected({ kind: 'discharged', row })}
                    >
                      {row.patientName} · {row.mrn}
                    </button>
                  </td>
                  <td>{row.bedLabel}</td>
                  <td className={row.invoice.isRefund ? 'refund-due' : 'balance-due'}>
                    {row.invoice.isRefund ? `Refund ${formatINR(row.invoice.refundPaise)}` : formatINR(row.invoice.balancePaise)}
                  </td>
                  <td>
                    <span className="frozen-badge">FROZEN</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {selected && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Invoice detail">
          <div className="modal">
            <header className="modal-header">
              <h2>
                {selected.row.patientName} · {selected.row.mrn}
              </h2>
              <button type="button" onClick={() => setSelected(null)} aria-label="Close">
                ×
              </button>
            </header>
            {selected.kind === 'active' ? (
              <InvoiceDetail invoice={selected.row.preview} />
            ) : (
              <InvoiceDetail invoice={selected.row.invoice} issuedAt={selected.row.invoice.issuedAt} frozen />
            )}
          </div>
        </div>
      )}
    </section>
  )
}
