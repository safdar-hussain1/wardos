import { formatINR } from '../core/money'
import { IST_OFFSET_MS } from '../core/billing'

export { formatINR }

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** Shifts a UTC instant by the fixed IST offset so UTC getters read as IST fields. */
function toIstFields(iso: string): Date {
  return new Date(new Date(iso).getTime() + IST_OFFSET_MS)
}

/** Formats an ISO instant as an IST calendar date, e.g. "01 Aug 2026". */
export function formatDateIST(iso: string): string {
  const ist = toIstFields(iso)
  const day = String(ist.getUTCDate()).padStart(2, '0')
  const month = MONTHS[ist.getUTCMonth()]
  const year = ist.getUTCFullYear()
  return `${day} ${month} ${year}`
}

/** Formats an ISO instant as IST date + 24h time, e.g. "01 Aug 2026, 09:00 IST". */
export function formatDateTimeIST(iso: string): string {
  const ist = toIstFields(iso)
  const hh = String(ist.getUTCHours()).padStart(2, '0')
  const mm = String(ist.getUTCMinutes()).padStart(2, '0')
  return `${formatDateIST(iso)}, ${hh}:${mm} IST`
}
