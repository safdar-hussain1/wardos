import type { ReactNode } from 'react'
import type { Actor } from '../../core/engine'
import type { Role } from '../../core/permissions'
import { store } from '../store'

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  RECEPTION: 'Reception Desk',
  DOCTOR: 'Doctor',
  NURSE: 'Nurse',
  BILLING: 'Billing Desk',
}

// Task 13 adds real screens behind these — rendered here as disabled links
// so the nav shape is visible now without wiring routes that don't exist yet.
const PLACEHOLDER_SCREENS = ['Patients', 'Billing', 'Staff & payroll', 'Ambulances', 'Event log']

export default function Shell({ actor, children }: { actor: Actor; children: ReactNode }) {
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
          <span className="nav-link nav-link--active">Ward board</span>
          {PLACEHOLDER_SCREENS.map((label) => (
            <span key={label} className="nav-link nav-link--disabled" title="Arrives in Task 13">
              {label}
            </span>
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
