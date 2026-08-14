import type { ComputedInvoice } from '../../core/billing'
import { formatINR, formatDateTimeIST } from '../format'

/**
 * Shared itemization view: nights/room total, charge lines, extras, deposit,
 * balance-or-refund. Used by PatientChart's discharged-invoice section and
 * by BillingDesk for both a live active-admission preview and a frozen
 * discharged invoice — one rendering, no duplicated JSX.
 */
export default function InvoiceDetail({
  invoice,
  issuedAt,
  frozen = false,
}: {
  invoice: ComputedInvoice
  /** Present only for an issued (discharged) invoice. */
  issuedAt?: string
  /** True once the admission has been discharged — the amounts can no longer change. */
  frozen?: boolean
}) {
  return (
    <div className="invoice-detail">
      {frozen && <p className="frozen-badge">Frozen</p>}
      <div className="inv-row">
        <span className="inv-row__label">
          Room · {invoice.nights} night{invoice.nights === 1 ? '' : 's'} × {formatINR(invoice.roomRatePaise)}
        </span>
        <span className="inv-row__amount">{formatINR(invoice.roomTotalPaise)}</span>
      </div>
      {invoice.lines.length === 0 ? (
        <p className="inv-empty">No extra charges.</p>
      ) : (
        <ul className="charge-list">
          {invoice.lines.map((line, i) => (
            <li key={i} className="inv-row">
              <span className="inv-row__label">
                <span className="charge-kind">{line.kind}</span> {line.description}
              </span>
              <span className="inv-row__amount">{formatINR(line.amountPaise)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="inv-row inv-row--rule">
        <span className="inv-row__label">Extras total</span>
        <span className="inv-row__amount">{formatINR(invoice.extrasTotalPaise)}</span>
      </div>
      <div className="inv-row">
        <span className="inv-row__label">Deposit</span>
        <span className="inv-row__amount">− {formatINR(invoice.depositPaise)}</span>
      </div>
      {invoice.isRefund ? (
        <div className="inv-row inv-row--total refund-due">
          <span className="inv-row__label">Refund due</span>
          <span className="inv-row__amount">{formatINR(invoice.refundPaise)}</span>
        </div>
      ) : (
        <div className="inv-row inv-row--total balance-due">
          <span className="inv-row__label">Balance due</span>
          <span className="inv-row__amount">{formatINR(invoice.balancePaise)}</span>
        </div>
      )}
      {issuedAt !== undefined && <p className="issued-at">Issued {formatDateTimeIST(issuedAt)}</p>}
    </div>
  )
}
