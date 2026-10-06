import type { ReactNode } from 'react'

/**
 * The interface's icon set, drawn on a 24-unit grid with a 1.8 stroke so
 * every glyph shares one weight. Inline SVG only: no icon font, no network.
 * Icons are decorative (aria-hidden); the control that holds one always
 * carries its own text or aria-label.
 */

export type IconName =
  | 'plan'
  | 'bill'
  | 'ambulance'
  | 'staff'
  | 'log'
  | 'sun'
  | 'moon'
  | 'play'
  | 'pause'
  | 'rewind'
  | 'chevron'
  | 'close'
  | 'check'
  | 'cross'
  | 'lock'
  | 'reset'
  | 'signout'
  | 'bed'
  | 'arrow'
  | 'database'
  | 'shield'
  | 'replay'
  | 'info'

const PATHS: Record<IconName, ReactNode> = {
  plan: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 11h7m4 0h7M10 4v7M14 11v9" />
    </>
  ),
  bill: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>
  ),
  ambulance: (
    <>
      <path d="M2.5 16.5V8a1 1 0 0 1 1-1h10v9.5" />
      <path d="M13.5 10h4l3 3.5v3h-1.5" />
      <circle cx="7" cy="17" r="1.9" />
      <circle cx="16.8" cy="17" r="1.9" />
      <path d="M8.9 17h6M2.5 16.5h2.6M8 9.5v4M6 11.5h4" />
    </>
  ),
  staff: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19.5c.6-3.3 3-5 6-5s5.4 1.7 6 5" />
      <path d="M15.5 4.9a3.2 3.2 0 0 1 0 6.2M17.5 14.7c1.9.6 3.1 2.2 3.5 4.8" />
    </>
  ),
  log: (
    <>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
    </>
  ),
  moon: <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />,
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  pause: <path d="M8.5 5.5v13M15.5 5.5v13" />,
  rewind: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
      <path d="M3 3.5v4.5h4.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  chevron: <path d="M6.5 9.5l5.5 5.5 5.5-5.5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M4.5 12.5l4.8 4.8L19.5 7" />,
  cross: <path d="M7 7l10 10M17 7L7 17" />,
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" />
    </>
  ),
  reset: (
    <>
      <path d="M4 12a8 8 0 1 0 2.3-5.6" />
      <path d="M4 4v4.5h4.5" />
    </>
  ),
  signout: (
    <>
      <path d="M14 4.5H6.5a1.5 1.5 0 0 0-1.5 1.5v12a1.5 1.5 0 0 0 1.5 1.5H14" />
      <path d="M10.5 12H20M16.5 8.5L20 12l-3.5 3.5" />
    </>
  ),
  bed: (
    <>
      <path d="M3 18.5V6M21 18.5v-6a2 2 0 0 0-2-2H10.5v5.5H3" />
      <rect x="4.5" y="9.5" width="4.5" height="3.5" rx="1.2" />
    </>
  ),
  arrow: <path d="M4.5 12h14M13.5 6.5L19 12l-5.5 5.5" />,
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7.5" ry="2.8" />
      <path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7.5 3v5.5c0 4.6-3.1 8.2-7.5 9.5-4.4-1.3-7.5-4.9-7.5-9.5V6z" />
      <path d="M8.8 12l2.3 2.3 4.2-4.6" />
    </>
  ),
  replay: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v4.5h-4.5" />
      <path d="M10.2 9.2v5.6l4.6-2.8z" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.6v.2" />
    </>
  ),
}

const FILLED: ReadonlySet<IconName> = new Set<IconName>(['play'])

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  const filled = FILLED.has(name)
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 1.4 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}

/** The WardOS mark: a ward cross on a signage plate. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="22" height="22" rx="6" fill="var(--sign)" />
      <path d="M10 5.5h4v4.5H18.5v4H14v4.5h-4V14H5.5v-4H10z" fill="var(--signal)" />
    </svg>
  )
}
