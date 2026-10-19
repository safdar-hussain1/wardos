import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../icons'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * A panel that slides in from the right (from the bottom on a phone) over
 * the page, for one patient, bed or bill at a time. It is a modal dialog:
 * focus moves into it, Tab and Shift+Tab stay inside, Escape or the backdrop
 * closes it, and focus returns to whatever opened it. When the control that
 * had focus is replaced (a form giving way to a chart, a confirmation
 * appearing), focus goes to the dialog's title rather than falling out of
 * the dialog.
 */
export default function Drawer({
  title,
  kicker,
  onClose,
  children,
}: {
  title: ReactNode
  /** A short line above the title (the bed and ward, say). */
  kicker?: ReactNode
  onClose: () => void
  children: ReactNode
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
    const titleEl = panel?.querySelector<HTMLElement>('.drawer__title') ?? null
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? titleEl
    first?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function focusables(): HTMLElement[] {
      if (!panel) return []
      return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
    }

    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const items = focusables()
      if (items.length === 0) {
        e.preventDefault()
        titleEl?.focus()
        return
      }
      const head = items[0]
      const tail = items[items.length - 1]
      const at = items.indexOf(document.activeElement as HTMLElement)
      // from the title (or anywhere not in the list) wrap into the dialog, never out of it
      if (at === -1) {
        e.preventDefault()
        ;(e.shiftKey ? tail : head).focus()
      } else if (e.shiftKey && at === 0) {
        e.preventDefault()
        tail.focus()
      } else if (!e.shiftKey && at === items.length - 1) {
        e.preventDefault()
        head.focus()
      }
    }

    // When the focused control is removed, browsers drop focus to <body>; bring it back to the title.
    const observer = new MutationObserver(() => {
      const now = document.activeElement
      if (panel && (now === null || now === document.body || !panel.contains(now))) titleEl?.focus()
    })
    if (panel) observer.observe(panel, { childList: true, subtree: true })

    document.addEventListener('keydown', onKey)
    return () => {
      observer.disconnect()
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [])

  return (
    <div className="drawer-layer">
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panelRef}>
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
