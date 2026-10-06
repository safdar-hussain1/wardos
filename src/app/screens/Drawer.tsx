import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../icons'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * A panel that slides in from the right (from the bottom on a phone) over
 * the page, for one patient, bed or bill at a time. It is a modal dialog:
 * focus moves into it, Tab stays inside, Escape or the backdrop closes it,
 * and focus returns to whatever opened it.
 */
export default function Drawer({
  title,
  kicker,
  onClose,
  children,
  wide = false,
}: {
  title: ReactNode
  /** A short line above the title (the bed and ward, say). */
  kicker?: ReactNode
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    // a bed on the floor plan is an SVG element, so accept either kind of opener
    const active = document.activeElement
    const opener = active instanceof HTMLElement || active instanceof SVGElement ? active : null
    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>('.drawer__title')
    first?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
      if (items.length === 0) return
      const head = items[0]
      const tail = items[items.length - 1]
      if (e.shiftKey && document.activeElement === head) {
        e.preventDefault()
        tail.focus()
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault()
        head.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [])

  return (
    <div className="drawer-layer">
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className={`drawer${wide ? ' drawer--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
      >
        <header className="drawer__head">
          <div className="drawer__titles">
            {kicker !== undefined && <div className="drawer__kicker">{kicker}</div>}
            <h2 className="drawer__title" id={titleId} tabIndex={-1}>
              {title}
            </h2>
          </div>
          <button type="button" className="icon-button drawer__close" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="drawer__body">{children}</div>
      </div>
    </div>
  )
}
