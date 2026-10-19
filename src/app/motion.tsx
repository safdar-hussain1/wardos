import { useEffect, useState } from 'react'

/** True when the visitor has asked their system for less motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Counts a number up from zero once, when `play` is set on the first render
 * (the page's arrival), easing out over `duration` after `delay`. Afterwards,
 * and whenever motion is reduced, it simply returns `target`, so later
 * changes (an admission, a replay) show at once.
 */
export function useCountUp(target: number, play: boolean, delay = 0, duration = 700): number {
  const [shown, setShown] = useState<number | null>(play ? 0 : null)

  useEffect(() => {
    if (!play) return
    if (prefersReducedMotion()) {
      setShown(null)
      return
    }
    let raf = 0
    const start = performance.now() + delay
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration))
      setShown(t >= 1 ? null : Math.round(target * (1 - Math.pow(1 - t, 3))))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // Runs once per mount: `play` is only ever true on the first render.
  }, [])

  return shown ?? target
}

/** A number that counts up on the page's arrival (see useCountUp). */
export function CountUp({ value, play, delay = 0 }: { value: number; play: boolean; delay?: number }) {
  return <>{useCountUp(value, play, delay)}</>
}
