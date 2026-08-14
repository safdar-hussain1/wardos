import type { ReactNode } from 'react'
import type { Actor } from '../../core/engine'
import type { Role } from '../../core/permissions'
import { can } from '../../core/permissions'
import { store } from '../store'

export type ScreenKey = 'ward' | 'billing' | 'payroll' | 'ambulances' | 'audit'

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
  { key: 'ward', label: 'Ward board', visible: () => true },
  { key: 'billing', label: 'Billing desk', visible: (role) => can(role, 'VIEW_BILLING') },
  { key: 'payroll', label: 'Payroll', visible: (role) => role === 'ADMIN' },
  { key: 'ambulances', label: 'Ambulances', visible: (role) => can(role, 'VIEW_CLINICAL') },
  { key: 'audit', label: 'Audit trail', visible: (role) => role === 'ADMIN' },
]

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
  function handleResetDemo(): void {
    const confirmed = window.confirm(
      'Reset the demo? This wipes all local changes and restores the original seeded hospital.',
    )
    if (!confirmed) return
    void store.resetDemo()
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>WardOS</h1>
        <nav className="app-nav" aria-label="Screens">
          {NAV_ITEMS.filter((item) => item.visible(actor.role)).map((item) => (
            <button
              key={item.key}
              type="button"
              className={`nav-link ${activeScreen === item.key ? 'nav-link--active' : ''}`}
              onClick={() => onNavigate(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="session-info">
          <span>{actor.username}</span>
          <span className="role-badge">{ROLE_LABELS[actor.role]}</span>
          <button type="button" onClick={handleResetDemo}>
            Reset demo
          </button>
          <button type="button" onClick={() => store.logout()}>
            Log out
          </button>
        </div>
      </header>
      <main className="app-content">{children}</main>
    </div>
  )
}
