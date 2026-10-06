import type { ComputedInvoice } from '../../core/billing'
import { formatINR, formatDateTimeIST } from '../format'
import { CHARGE_KIND_LABELS } from '../labels'
import { Icon } from '../icons'

/**
 * One bill, laid out like the printed slip a patient takes home: the room
 * (nights times the nightly rate), each extra charge, the deposit taken off,
 * and what is left to pay or to give back. The same view serves a running
 * bill (still changing) and an issued one (final, once the patient leaves).
 * Every amount here comes from the engine; this view does no arithmetic.
 */
export default function InvoiceDetail({
  invoice,
  issuedAt,
  final = false,
}: {
  invoice: ComputedInvoice
  /** Present only for an issued (discharged) bill. */
  issuedAt?: string
  /** True once the patient has been discharged: the amounts can no longer change. */
  final?: boolean
}) {
  const nights = `${invoice.nights} night${invoice.nights === 1 ? '' : 's'}`
  return (
    <div className={`receipt${final ? ' receipt--final' : ''}`}>
      <p className="receipt__status">
        {final ? (
          <>
            <Icon name="lock" size={16} /> Final bill{issuedAt !== undefined ? `, issued ${formatDateTimeIST(issuedAt)}` : ''}
          </>
        ) : (
          <>
            <span className="live-dot" aria-hidden="true" /> Running bill, as of now
          </>
        )}
      </p>
      <dl className="receipt__lines">
        <div className="receipt__row">
          <dt>
            Room, {nights} at {formatINR(invoice.roomRatePaise)}
          </dt>
          <dd className="num">{formatINR(invoice.roomTotalPaise)}</dd>
        </div>
        {invoice.lines.map((line, i) => (
          <div className="receipt__row" key={i}>
            <dt>
              {line.description}
              <span className="receipt__kind">{CHARGE_KIND_LABELS[line.kind] ?? line.kind}</span>
            </dt>
            <dd className="num">{formatINR(line.amountPaise)}</dd>
          </div>
        ))}
        {invoice.lines.length === 0 && (
          <div className="receipt__row receipt__row--empty">
            <dt>No extra charges yet</dt>
            <dd />
          </div>
        )}
        <div className="receipt__row receipt__row--sub">
          <dt>Deposit paid</dt>
          <dd className="num">− {formatINR(invoice.depositPaise)}</dd>
        </div>
      </dl>
      <div className={`receipt__total ${invoice.isRefund ? 'receipt__total--refund' : 'receipt__total--due'}`}>
        <span>{invoice.isRefund ? (final ? 'Refund to the patient' : 'Refund if they left now') : final ? 'Left to pay' : 'Left to pay if they left now'}</span>
        <strong className="num">{formatINR(invoice.isRefund ? invoice.refundPaise : invoice.balancePaise)}</strong>
      </div>
    </div>
  )
}
