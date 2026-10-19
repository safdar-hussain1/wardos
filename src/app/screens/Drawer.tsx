import { useCallback, useEffect, useId, useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../icons'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** The longest the exit animation may keep a closing panel on screen. */
const EXIT_LIMIT_MS = 500

// Where focus goes back to once the last panel has closed. One panel can give
// way to another in a single update (a patient's chart to their final bill),
// and the second must still return focus to the bed that opened the first.
let returnFocusTo: HTMLElement | SVGElement | null = null
let openPanels = 0

/**
 * A panel that slides in from the right (from the bottom on a phone) over
 * the page, for one patient, bed or bill at a time. It is a native modal
 * <dialog>: showModal() puts it in the top layer and makes the rest of the
 * page inert. Escape, a click on the backdrop, the close button and any
 * button inside marked `data-close` all close it the same way, with a short
 * exit animation, and focus returns to whatever opened it. Tab and Shift+Tab
 * cycle inside it. When the control that had focus is replaced (a form giving
 * way to a chart, a confirmation appearing), focus goes to the panel's title
 * rather than falling out of the panel.
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
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const closingRef = useRef(false)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // Marks the panel as closing, which the stylesheet turns into the exit
  // animation while it is still in the top layer, then lets the parent remove
  // it once that has played. A closing panel takes no more input.
  const requestClose = useCallback(() => {
    const dialog = dialogRef.current
    if (!dialog || closingRef.current) return
    closingRef.current = true
    dialog.setAttribute('data-closing', '')
    dialog.inert = true
    // only what can finish: a running bill's live dot pulses for ever
    const running = dialog
      .getAnimations({ subtree: true })
      .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
    if (running.length === 0) {
      onCloseRef.current()
      return
    }
    void Promise.race([
      Promise.allSettled(running.map((a) => a.finished)),
      new Promise((resolve) => window.setTimeout(resolve, EXIT_LIMIT_MS)),
    ]).then(() => onCloseRef.current())
  }, [])

  // Opened before the first paint, so the panel is never seen outside the top layer.
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    openPanels += 1
    // A bed on the floor plan is an SVG element, so accept either kind of
    // opener. Focus is on <body> when the panel this one replaced took it
    // along; the earlier opener then still stands.
    const active = document.activeElement
    if ((active instanceof HTMLElement || active instanceof SVGElement) && active !== document.body) {
      returnFocusTo = active
    }
    if (!dialog.open) dialog.showModal()
    ;(dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog.querySelector<HTMLElement>('.drawer__title'))?.focus()
    return () => {
      openPanels -= 1
    }
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    closingRef.current = false
    const titleEl = dialog.querySelector<HTMLElement>('.drawer__title')

    // Escape, and a backdrop click where the browser handles `closedby`,
    // arrive as a cancellable close request: animate out instead.
    const onCancel = (e: Event) => {
      e.preventDefault()
      requestClose()
    }
    // If the browser closes the panel itself anyway, keep the parent in step.
    const onNativeClose = () => {
      if (!dialog.open && !closingRef.current) onCloseRef.current()
    }
    // Browsers without `closedby` get the backdrop click by hand: a press
    // and release on the dialog element itself, outside its box, landed on
    // the backdrop. Requiring both ends there keeps a text selection dragged
    // out of the panel from closing it.
    const handBuiltLightDismiss = !('closedBy' in HTMLDialogElement.prototype)
    const isOnBackdrop = (e: MouseEvent) => {
      if (e.target !== dialog) return false
      const r = dialog.getBoundingClientRect()
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom
    }
    let pressedOnBackdrop = false
    const onPointerDown = (e: PointerEvent) => {
      pressedOnBackdrop = handBuiltLightDismiss && isOnBackdrop(e)
    }
    const onClick = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest('[data-close]')) requestClose()
      else if (pressedOnBackdrop && isOnBackdrop(e)) requestClose()
    }
    // Tab and Shift+Tab cycle inside the panel rather than leaving for the browser's own controls.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
      if (items.length === 0) {
        e.preventDefault()
        titleEl?.focus()
        return
      }
      const head = items[0]
      const tail = items[items.length - 1]
      const at = items.indexOf(document.activeElement as HTMLElement)
      // from the title (or anywhere not in the list) wrap into the panel, never out of it
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
      if (closingRef.current) return
      const now = document.activeElement
      if (now === null || now === document.body || !dialog.contains(now)) titleEl?.focus()
    })
    observer.observe(dialog, { childList: true, subtree: true })

    dialog.addEventListener('cancel', onCancel)
    dialog.addEventListener('close', onNativeClose)
    dialog.addEventListener('pointerdown', onPointerDown)
    dialog.addEventListener('click', onClick)
    dialog.addEventListener('keydown', onKey)
    return () => {
      observer.disconnect()
      dialog.removeEventListener('cancel', onCancel)
      dialog.removeEventListener('close', onNativeClose)
      dialog.removeEventListener('pointerdown', onPointerDown)
      dialog.removeEventListener('click', onClick)
      dialog.removeEventListener('keydown', onKey)
      closingRef.current = true
      if (dialog.open) dialog.close()
      if (openPanels === 0) {
        const opener = returnFocusTo
        returnFocusTo = null
        if (opener && document.contains(opener)) opener.focus()
      }
    }
  }, [requestClose])

  return (
    <dialog className="drawer" closedby="any" aria-labelledby={titleId} ref={dialogRef}>
      <header className="drawer__head">
        <div className="drawer__titles">
          {kicker !== undefined && <div className="drawer__kicker">{kicker}</div>}
          <h2 className="drawer__title" id={titleId} tabIndex={-1}>
            {title}
          </h2>
        </div>
        <button type="button" className="icon-button drawer__close" onClick={requestClose} aria-label="Close">
          <Icon name="close" />
        </button>
      </header>
      <div className="drawer__body">{children}</div>
    </dialog>
  )
}
