import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { RefObject } from 'react'
import { flushSync } from 'react-dom'
import { prefersReducedMotion } from './motion'
import { routeFromHash } from './routes'
import type { RouteKey } from './routes'

let renderingTransition = false

/**
 * True while a view transition is rendering its new state, so a component
 * mounting then can leave its own entrance to the transition's cross-fade.
 */
export function isRenderingViewTransition(): boolean {
  return renderingTransition
}

/** Runs a DOM update inside a view transition where the browser has them, and at once elsewhere. */
function withViewTransition(update: () => void): ViewTransition | null {
  if (typeof document.startViewTransition !== 'function') {
    update()
    return null
  }
  const transition = document.startViewTransition(() => {
    renderingTransition = true
    try {
      // the new state must be on the page when this returns, as that is when the browser takes its picture
      flushSync(update)
    } finally {
      renderingTransition = false
    }
  })
  // one cut short (another view picked straight away) has still updated the page; nothing to report
  transition.ready.catch(() => undefined)
  return transition
}

// -- the URL hash -----------------------------------------------------------

// The hash the views read. It moves on in one place, so that a change of view
// can run inside a view transition: the browser pictures the old view, the
// new one renders, and the browser cross-fades from one to the other.
let shownHash = typeof window === 'undefined' ? '' : window.location.hash
const hashListeners = new Set<() => void>()

function publishHash(): void {
  shownHash = window.location.hash
  for (const listener of hashListeners) listener()
}

function onHashChange(e: HashChangeEvent): void {
  const changesView = routeFromHash(window.location.hash) !== routeFromHash(shownHash)
  // the ?screen= alias dispatches its own change at boot, before any view is on screen
  if (changesView && e.isTrusted) withViewTransition(publishHash)
  else publishHash()
}

function subscribeHash(onChange: () => void): () => void {
  if (hashListeners.size === 0) {
    shownHash = window.location.hash
    window.addEventListener('hashchange', onHashChange)
  }
  hashListeners.add(onChange)
  return () => {
    hashListeners.delete(onChange)
    if (hashListeners.size === 0) window.removeEventListener('hashchange', onHashChange)
  }
}

function readHash(): string {
  return shownHash
}

/** The current hash (raw) and the view it selects; re-renders on every hash change. */
export function useHashRoute(): { route: RouteKey; hash: string } {
  const hash = useSyncExternalStore(subscribeHash, readHash, () => '')
  return { route: routeFromHash(hash), hash }
}

export function navigateTo(hash: string): void {
  window.location.hash = hash.startsWith('#') ? hash : `#${hash}`
}

// -- media queries ------------------------------------------------------------

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)')
}

// -- element size ---------------------------------------------------------------

/**
 * The element's content-box width, kept current with a ResizeObserver (0
 * until its first report, which arrives before the next paint).
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return width
}

// -- theme: day shift / night shift ---------------------------------------------

export type Theme = 'light' | 'dark'

const THEME_KEY = 'wardos-theme'

function readTheme(): Theme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

const themeListeners = new Set<() => void>()

function subscribeTheme(onChange: () => void): () => void {
  themeListeners.add(onChange)
  return () => themeListeners.delete(onChange)
}

/**
 * The theme index.html stamped before first paint, plus a setter that
 * persists the choice first, so a reload (e.g. after resetting the demo)
 * already boots into it. Given the point the switch was pressed at, the new
 * theme spreads out from there in a growing circle (a view transition, so
 * only where the browser has them and motion is not reduced).
 */
export function useTheme(): [Theme, (next: Theme, from?: { x: number; y: number }) => void] {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => 'light' as Theme)
  const setTheme = useCallback((next: Theme, from?: { x: number; y: number }) => {
    const apply = () => {
      try {
        localStorage.setItem(THEME_KEY, next)
      } catch {
        /* storage unavailable: the attribute still switches this session */
      }
      document.documentElement.setAttribute('data-theme', next)
      for (const listener of themeListeners) listener()
    }
    if (!from || prefersReducedMotion()) {
      apply()
      return
    }
    const root = document.documentElement
    root.classList.add('theme-shift')
    const transition = withViewTransition(apply)
    if (!transition) {
      root.classList.remove('theme-shift')
      return
    }
    // the farthest corner from the switch, so the circle ends covering the whole window
    const radius = Math.hypot(Math.max(from.x, window.innerWidth - from.x), Math.max(from.y, window.innerHeight - from.y))
    transition.ready
      .then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${from.x}px ${from.y}px)`, `circle(${radius}px at ${from.x}px ${from.y}px)`] },
          { duration: 560, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' },
        )
      })
      .catch(() => {
        /* the transition was skipped: the theme has still switched */
      })
    const done = () => root.classList.remove('theme-shift')
    transition.finished.then(done, done)
  }, [])
  return [theme, setTheme]
}
