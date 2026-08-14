import { useState } from 'react'
import type { FormEvent } from 'react'
import { store } from './store'
import { DEMO_ACCOUNTS } from '../seed/facility'

const ROLE_LABELS: Record<(typeof DEMO_ACCOUNTS)[number]['role'], string> = {
  ADMIN: 'Administrator',
  RECEPTION: 'Reception Desk',
  DOCTOR: 'Doctor',
  NURSE: 'Nurse',
  BILLING: 'Billing Desk',
}

export default function Login({ error }: { error?: string }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault()
    store.login(username, password)
  }

  function fillAccount(u: string, p: string): void {
    setUsername(u)
    setPassword(p)
  }

  return (
    <main className="login-shell">
      <h1>WardOS</h1>
      <p className="login-tagline">Sign in to the demo hospital</p>

      <form className="login-form" onSubmit={handleSubmit}>
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error !== undefined && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit">Log in</button>
      </form>

      <div className="demo-accounts">
        <p className="demo-accounts-label">Demo accounts</p>
        <div className="demo-account-grid">
          {DEMO_ACCOUNTS.map((acc) => (
            <button
              key={acc.username}
              type="button"
              className="demo-account-card"
              onClick={() => fillAccount(acc.username, acc.password)}
            >
              <strong>{ROLE_LABELS[acc.role]}</strong>
              <span>{acc.username}</span>
            </button>
          ))}
        </div>
      </div>
    </main>
  )
}
