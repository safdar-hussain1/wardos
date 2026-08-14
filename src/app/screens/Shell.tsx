import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Actor } from '../../core/engine'
import type { Role } from '../../core/permissions'
import { can } from '../../core/permissions'
import { store } from '../store'

export type ScreenKey = 'deck' | 'ward' | 'billing' | 'payroll' | 'ambulances' | 'audit' | 'time-machine' | 'about'

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  RECEPTION: 'Reception Desk',
  DOCTOR: 'Doctor',
  NURSE: 'Nurse',
  BILLING: 'Billing Desk',
}

/**
 * The nav's fixed screen order, each with the permission check that decides
 * whether it's shown for the current role. Payroll and Audit trail are
 * ADMIN-only (no dedicated permission for either in `permissions.ts`, so
 * gated directly on role, same as the components themselves guard).
 */
const NAV_ITEMS: { key: ScreenKey; label: string; visible: (role: Role) => boolean }[] = [
  { key: 'deck', label: 'Command deck', visible: () => true },
  { key: 'ward', label: 'Ward board', visible: () => true },
  { key: 'billing', label: 'Billing desk', visible: (role) => can(role, 'VIEW_BILLING') },
  { key: 'payroll', label: 'Payroll', visible: (role) => role === 'ADMIN' },
  { key: 'ambulances', label: 'Ambulances', visible: (role) => can(role, 'VIEW_CLINICAL') },
  { key: 'audit', label: 'Audit trail', visible: (role) => role === 'ADMIN' },
  { key: 'time-machine', label: 'Time machine', visible: () => true },
  { key: 'about', label: 'Results', visible: () => true },
]

/** One quiet line under each screen title — what this screen is for. */
const SCREEN_SUBTITLES: Record<ScreenKey, string> = {
  deck: 'The live operating picture — census, occupancy, revenue, and the latest events.',
  ward: 'Thirty-two beds across four wards. Select a free bed to admit, an occupied one to open the chart.',
  billing: 'Running previews for every active admission, and the frozen invoices behind every discharge.',
  payroll: 'Monthly pay for the whole roster, itemized rule by rule. Select a row for the breakdown.',
  ambulances: 'The fleet — dispatch a free unit, return one on station.',
  audit: 'Every command this hospital has ever run, event by event.',
  'time-machine':
    'Scrub across six months of history — every number is a pure replay of the event log, never a query against the live database.',
  about: 'What WardOS is, five structural claims, and the benchmark that backs them.',
}

/** The brand mark: a ward-cross in the accent ink. Pure inline SVG. */
function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="22" height="22" rx="6" fill="var(--accent)" />
      <path d="M10 5.5h4v4.5H18.5v4H14v4.5h-4V14H5.5v-4H10z" fill="var(--accent-contrast)" />
    </svg>
  )
}

function readTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

export default function Shell({
  actor,
  activeScreen,
  onNavigate,
  children,
}: {
  actor: Actor
  activeScreen: ScreenKey
  onNavigate: (screen: ScreenKey) => void
  children: ReactNode
}) {
  const [theme, setTheme] = useState<'light' | 'dark'>(readTheme)

  function handleToggleTheme(): void {
    const next = theme === 'dark' ? 'light' : 'dark'
    // Persist first, then stamp — so any reload (e.g. reset demo) already
    // finds the choice in localStorage and boots straight into it.
    try {
      localStorage.setItem('wardos-theme', next)
    } catch {
      /* storage unavailable — the attribute still switches this session */
    }
    document.documentElement.setAttribute('data-theme', next)
    setTheme(next)
  }

  function handleResetDemo(): void {
    const confirmed = window.confirm(
      'Reset the demo? This wipes all local changes and restores the original seeded hospital.',
    )
    if (!confirmed) return
    void store.resetDemo()
  }

  const active = NAV_ITEMS.find((item) => item.key === activeScreen)

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <BrandMark />
          <h1>WardOS</h1>
        </div>
        <nav className="app-nav" aria-label="Screens">
          {NAV_ITEMS.filter((item) => item.visible(actor.role)).map((item) => (
            <button
              key={item.key}
              type="button"
              className={`nav-link ${activeScreen === item.key ? 'nav-link--active' : ''}`}
              aria-current={activeScreen === item.key ? 'page' : undefined}
              onClick={() => onNavigate(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="session-info">
          <span className="session-user">{actor.username}</span>
          <span className="role-badge">{ROLE_LABELS[actor.role]}</span>
          <button
            type="button"
            className="theme-toggle"
            onClick={handleToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? (
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8" />
                </g>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path
                  d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
          <button type="button" className="session-action" onClick={handleResetDemo}>
            Reset demo
          </button>
          <button type="button" className="session-action" onClick={() => store.logout()}>
            Log out
          </button>
        </div>
      </header>
      {active && (
        <div className="screen-head">
          <h2 className="screen-head__title">{active.label}</h2>
          <p className="screen-head__sub">{SCREEN_SUBTITLES[active.key]}</p>
        </div>
      )}
      <main className="app-content">{children}</main>
    </div>
  )
}
