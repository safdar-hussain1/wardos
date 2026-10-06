import { useState } from 'react'
import type { FormEvent } from 'react'
import { store } from './store'
import { DEMO_ACCOUNTS } from '../seed/facility'
import type { Role } from '../core/permissions'
import { ROLE_BLURBS, ROLE_LABELS, ROLE_ORDER } from './labels'
import { setPreferredRole, switchRole } from './session'
import { BrandMark, Icon } from './icons'

/**
 * Shown after signing out (and if the database could not be opened). The
 * demo accounts are public, so each role is one click; the form below does
 * the same thing the long way, against the same bcrypt check.
 */
export default function Login({ error }: { error?: string }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  function submit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault()
    const account = DEMO_ACCOUNTS.find((a) => a.username === username.trim())
    setPreferredRole(account ? (account.role as Role) : null)
    store.login(username.trim(), password)
  }

  return (
    <main className="signin" id="main">
      <div className="signin__card">
        <div className="signin__brand">
          <BrandMark size={40} />
          <span>WardOS</span>
        </div>
        <h1 className="signin__title">Who’s on shift?</h1>
        <p className="signin__lead">
          Each role sees and can do different things. Pick one to walk the wards; you can switch at any time.
        </p>

        {error !== undefined && (
          <p className="notice notice--bad" role="alert">
            <Icon name="cross" size={18} />
            {error === 'invalid username or password'
              ? 'That username and password do not match a demo account.'
              : `The hospital database could not be opened: ${error}`}
          </p>
        )}

        <ul className="signin__roles">
          {ROLE_ORDER.map((role) => {
            const account = DEMO_ACCOUNTS.find((a) => a.role === role)
            return (
              <li key={role}>
                <button type="button" className="rolecard" onClick={() => switchRole(role)}>
                  <span className={`avatar avatar--large avatar--${role.toLowerCase()}`} aria-hidden="true">
                    {ROLE_LABELS[role][0]}
                  </span>
                  <span className="rolecard__text">
                    <strong>{ROLE_LABELS[role]}</strong>
                    <span>{ROLE_BLURBS[role]}</span>
                  </span>
                  <span className="rolecard__user">{account?.username}</span>
                </button>
              </li>
            )
          })}
        </ul>

        <details className="signin__manual">
          <summary>Sign in with a username and password instead</summary>
          <form className="form" onSubmit={submit}>
            <label className="field">
              <span className="field__label">Username</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </label>
            <label className="field">
              <span className="field__label">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            <p className="field__hint">
              The demo passwords are in the project’s README. Passwords are checked against bcrypt hashes in the
              database.
            </p>
            <button type="submit" className="button button--primary">
              Sign in
            </button>
          </form>
        </details>
      </div>
    </main>
  )
}
