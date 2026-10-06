import { useState } from 'react'
import type { Engine, Actor } from '../../core/engine'
import type { ComputedInvoice } from '../../core/billing'
import { addP } from '../../core/money'
import { ANCHOR_ISO } from '../../core/clock'
import { billingVm, deckVm } from '../viewmodels'
import { formatINR } from '../format'
import { WARD_LABELS } from '../labels'
import Drawer from './Drawer'
import { ChartPanel, WardPlate } from './BedPanel'
import InvoiceDetail from './InvoiceDetail'
import { Icon } from '../icons'

type Tab = 'running' | 'final'
type Open =
  | { kind: 'running'; admissionId: number }
  | { kind: 'final'; admissionId: number }
  | { kind: 'issued'; invoice: ComputedInvoice; patientName: string; bedLabel: string; ward: string }

function Outcome({ invoice, final }: { invoice: ComputedInvoice; final: boolean }) {
  if (invoice.isRefund) {
    return (
      <span className="outcome outcome--refund">
        <Icon name="arrow" size={14} className="outcome__icon outcome__icon--back" />
        {final ? 'Refunded' : 'Refund'} {formatINR(invoice.refundPaise)}
      </span>
    )
  }
  if (invoice.balancePaise === 0) return <span className="outcome">Settled</span>
  return (
    <span className="outcome outcome--due">
      <Icon name="arrow" size={14} className="outcome__icon" />
      Owes {formatINR(invoice.balancePaise)}
    </span>
  )
}

export default function BillingDesk({ engine, actor }: { engine: Engine; actor: Actor }) {
  const [tab, setTab] = useState<Tab>('running')
  const [open, setOpen] = useState<Open | null>(null)

  // Re-read on every render, so a deposit or a discharge shows at once.
  const vm = billingVm(engine, actor)
  const totals = deckVm(engine)
  const beds = engine.beds()
  const wardOf = (label: string) => beds.find((b) => b.label === label)?.ward ?? 'GENERAL'

  const openRow = open && open.kind !== 'issued' ? open : null
  const runningRow = openRow?.kind === 'running' ? vm.active.find((r) => r.admissionId === openRow.admissionId) : undefined
  const finalRow = openRow?.kind === 'final' ? vm.discharged.find((r) => r.admissionId === openRow.admissionId) : undefined

  return (
    <section className="page" aria-labelledby="bills-title">
      <header className="page-head">
        <h1 id="bills-title">Bills</h1>
        <p>
          Every stay is billed in whole paise: the nights in a bed times its nightly rate, plus any extras, minus
          the deposit. A bill runs while the patient is in, and becomes final when they leave.
        </p>
      </header>

      <p className="page-summary">
        <strong>{vm.active.length}</strong> patients are in beds now, with bills still running.{' '}
        <strong>{vm.discharged.length}</strong> have gone home: {formatINR(totals.outstandingPaise)} is still owed on
        their final bills, and {totals.refundCount} got money back.
      </p>

      <div className="tabs" role="tablist" aria-label="Which bills">
        <button
          type="button"
          role="tab"
          id="tab-running"
          aria-selected={tab === 'running'}
          aria-controls="panel-bills"
          className={tab === 'running' ? 'is-on' : ''}
          onClick={() => setTab('running')}
        >
          Running <span className="tabs__count">{vm.active.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          id="tab-final"
          aria-selected={tab === 'final'}
          aria-controls="panel-bills"
          className={tab === 'final' ? 'is-on' : ''}
          onClick={() => setTab('final')}
        >
          Final <span className="tabs__count">{vm.discharged.length}</span>
        </button>
      </div>

      <div id="panel-bills" role="tabpanel" aria-labelledby={tab === 'running' ? 'tab-running' : 'tab-final'}>
        {tab === 'running' ? (
          vm.active.length === 0 ? (
            <p className="empty">Nobody is in a bed. Admit someone from the Hospital view and their bill starts here.</p>
          ) : (
            <div className="table-wrap">
              <table className="ledger">
                <thead>
                  <tr>
                    <th scope="col">Patient</th>
                    <th scope="col">Bed</th>
                    <th scope="col" className="ledger__num">
                      Nights
                    </th>
                    <th scope="col" className="ledger__num">
                      So far
                    </th>
                    <th scope="col" className="ledger__num">
                      Deposit
                    </th>
                    <th scope="col" className="ledger__num">
                      If they left now
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {vm.active.map((row) => (
                    <tr key={row.admissionId} onClick={() => setOpen({ kind: 'running', admissionId: row.admissionId })}>
                      <td>
                        <button
                          type="button"
                          className="ledger__who"
                          onClick={(e) => {
                            e.stopPropagation()
                            setOpen({ kind: 'running', admissionId: row.admissionId })
                          }}
                        >
                          <strong>{row.patientName}</strong>
                          <span>{row.mrn}</span>
                        </button>
                      </td>
                      <td>
                        <WardPlate ward={wardOf(row.bedLabel)} label={row.bedLabel} />
                      </td>
                      <td className="ledger__num num">{row.preview.nights}</td>
                      <td className="ledger__num num">
                        {formatINR(addP(row.preview.roomTotalPaise, row.preview.extrasTotalPaise))}
                      </td>
                      <td className="ledger__num num">{formatINR(row.preview.depositPaise)}</td>
                      <td className="ledger__num">
                        <Outcome invoice={row.preview} final={false} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : vm.discharged.length === 0 ? (
          <p className="empty">No one has been discharged yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="ledger">
              <thead>
                <tr>
                  <th scope="col">Patient</th>
                  <th scope="col">Bed</th>
                  <th scope="col" className="ledger__num">
                    Nights
                  </th>
                  <th scope="col" className="ledger__num">
                    Total
                  </th>
                  <th scope="col" className="ledger__num">
                    Deposit
                  </th>
                  <th scope="col" className="ledger__num">
                    Result
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...vm.discharged].reverse().map((row) => (
                  <tr key={row.admissionId} onClick={() => setOpen({ kind: 'final', admissionId: row.admissionId })}>
                    <td>
                      <button
                        type="button"
                        className="ledger__who"
                        onClick={(e) => {
                          e.stopPropagation()
                          setOpen({ kind: 'final', admissionId: row.admissionId })
                        }}
                      >
                        <strong>{row.patientName}</strong>
                        <span>{row.mrn}</span>
                      </button>
                    </td>
                    <td>
                      <WardPlate ward={wardOf(row.bedLabel)} label={row.bedLabel} />
                    </td>
                    <td className="ledger__num num">{row.invoice.nights}</td>
                    <td className="ledger__num num">
                      {formatINR(addP(row.invoice.roomTotalPaise, row.invoice.extrasTotalPaise))}
                    </td>
                    <td className="ledger__num num">{formatINR(row.invoice.depositPaise)}</td>
                    <td className="ledger__num">
                      <Outcome invoice={row.invoice} final />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {runningRow && (
        <Drawer
          kicker={
            <>
              <WardPlate ward={wardOf(runningRow.bedLabel)} label={runningRow.bedLabel} />{' '}
              {WARD_LABELS[wardOf(runningRow.bedLabel)]}
            </>
          }
          title={runningRow.patientName}
          onClose={() => setOpen(null)}
        >
          <ChartPanel
            engine={engine}
            actor={actor}
            admissionId={runningRow.admissionId}
            anchorIso={ANCHOR_ISO}
            onMoved={() => undefined}
            onDischarged={(invoice, patientName) =>
              setOpen({
                kind: 'issued',
                invoice,
                patientName,
                bedLabel: runningRow.bedLabel,
                ward: wardOf(runningRow.bedLabel),
              })
            }
          />
        </Drawer>
      )}

      {finalRow && (
        <Drawer
          kicker={
            <>
              <WardPlate ward={wardOf(finalRow.bedLabel)} label={finalRow.bedLabel} /> {finalRow.mrn}
            </>
          }
          title={`Bill for ${finalRow.patientName}`}
          onClose={() => setOpen(null)}
        >
          <InvoiceDetail invoice={finalRow.invoice} issuedAt={finalRow.invoice.issuedAt} final />
        </Drawer>
      )}

      {open?.kind === 'issued' && (
        <Drawer
          kicker={
            <>
              <WardPlate ward={open.ward} label={open.bedLabel} /> Discharged
            </>
          }
          title={`Bill for ${open.patientName}`}
          onClose={() => setOpen(null)}
        >
          <p className="notice notice--ok" role="status">
            <Icon name="check" size={18} /> Discharged. This bill is final and {open.bedLabel} is free again.
          </p>
          <InvoiceDetail invoice={open.invoice} issuedAt={ANCHOR_ISO} final />
        </Drawer>
      )}
    </section>
  )
}
