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
      {frozen && <p className="frozen-badge">FROZEN</p>}
      <p>Nights: {invoice.nights}</p>
      <p>
        Room total ({formatINR(invoice.roomRatePaise)}/night): {formatINR(invoice.roomTotalPaise)}
      </p>
      {invoice.lines.length === 0 ? (
        <p>No charges.</p>
      ) : (
        <ul className="charge-list">
          {invoice.lines.map((line, i) => (
            <li key={i}>
              {line.kind} — {line.description}: {formatINR(line.amountPaise)}
            </li>
          ))}
        </ul>
      )}
      <p>Extras total: {formatINR(invoice.extrasTotalPaise)}</p>
      <p>Deposit: {formatINR(invoice.depositPaise)}</p>
      {invoice.isRefund ? (
        <p className="refund-due">Refund due: {formatINR(invoice.refundPaise)}</p>
      ) : (
        <p className="balance-due">Balance due: {formatINR(invoice.balancePaise)}</p>
      )}
      {issuedAt !== undefined && <p className="issued-at">Issued {formatDateTimeIST(issuedAt)}</p>}
    </div>
  )
}
