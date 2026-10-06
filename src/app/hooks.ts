import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { RefObject } from 'react'
import { routeFromHash } from './routes'
import type { RouteKey } from './routes'

// -- the URL hash -----------------------------------------------------------

function subscribeHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function readHash(): string {
  return window.location.hash
}

/** The current hash (raw) and the view it selects; re-renders on every hash change. */
export function useHashRoute(): { route: RouteKey; hash: string } {
  const hash = useSyncExternalStore(subscribeHash, readHash, () => '')
  return { route: routeFromHash(hash), hash }
}

export function navigateTo(hash: string): void {
  const next = hash.startsWith('#') ? hash : `#${hash}`
  if (window.location.hash === next) {
    // Same hash again (e.g. "How it works" clicked twice): still scroll to it.
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    return
  }
  window.location.hash = next
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

/** The element's content-box width, kept current with a ResizeObserver (0 until measured). */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
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
 * already boots into it.
 */
export function useTheme(): [Theme, (next: Theme) => void] {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => 'light' as Theme)
  const setTheme = useCallback((next: Theme) => {
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      /* storage unavailable: the attribute still switches this session */
    }
    document.documentElement.setAttribute('data-theme', next)
    for (const listener of themeListeners) listener()
  }, [])
  return [theme, setTheme]
}
