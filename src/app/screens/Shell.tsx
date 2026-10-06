import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Actor } from '../../core/engine'
import type { Role } from '../../core/permissions'
import { store } from '../store'
import { ROLE_BLURBS, ROLE_LABELS, ROLE_ORDER } from '../labels'
import { NAV_ROUTES, routeDef } from '../routes'
import type { RouteKey } from '../routes'
import { useTheme, navigateTo } from '../hooks'
import { switchRole, signOut } from '../session'
import { BrandMark, Icon } from '../icons'
import type { IconName } from '../icons'

const NAV_ICONS: Record<RouteKey, IconName> = {
  hospital: 'plan',
  bills: 'bill',
  ambulances: 'ambulance',
  staff: 'staff',
  'event-log': 'log',
  measurements: 'info',
}

function NavLinks({ actor, route, variant }: { actor: Actor; route: RouteKey; variant: 'top' | 'tabs' }) {
  return (
    <>
      {NAV_ROUTES.map((key) => {
        const def = routeDef(key)
        const locked = !def.allowed(actor.role)
        const current = route === key
        return (
          <a
            key={key}
            href={`#${key}`}
            className={`navlink navlink--${variant}${current ? ' is-current' : ''}${locked ? ' is-locked' : ''}`}
            aria-current={current ? 'page' : undefined}
            aria-label={locked ? `${def.label} (only ${def.whoCan})` : undefined}
          >
            <Icon name={NAV_ICONS[key]} size={variant === 'tabs' ? 22 : 18} />
            <span className="navlink__text">{def.label}</span>
            {locked && <Icon name="lock" size={14} className="navlink__lock" />}
          </a>
        )
      })}
    </>
  )
}

function RoleMenu({ actor }: { actor: Actor }) {
  const [open, setOpen] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onPointer(e: PointerEvent): void {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (!open) setConfirmReset(false)
  }, [open])

  function pick(role: Role): void {
    setOpen(false)
    if (role !== actor.role) switchRole(role)
    buttonRef.current?.focus()
  }

  function reset(): void {
    setOpen(false)
    navigateTo('hospital')
    void store.resetDemo()
  }

  return (
    <div className="rolemenu" ref={wrapRef}>
      <button
        type="button"
        className="rolemenu__button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        ref={buttonRef}
      >
        <span className={`avatar avatar--${actor.role.toLowerCase()}`} aria-hidden="true">
          {ROLE_LABELS[actor.role][0]}
        </span>
        <span className="rolemenu__text">
          <span className="rolemenu__small">On shift as</span>
          <span className="rolemenu__role">{ROLE_LABELS[actor.role]}</span>
        </span>
        <Icon name="chevron" size={16} />
      </button>
      {open && (
        <div className="rolemenu__panel">
          <p className="rolemenu__heading">Switch role to see what changes</p>
          <ul className="rolemenu__list">
            {ROLE_ORDER.map((role) => (
              <li key={role}>
                <button
                  type="button"
                  className={`rolemenu__item${role === actor.role ? ' is-current' : ''}`}
                  aria-current={role === actor.role ? 'true' : undefined}
                  onClick={() => pick(role)}
                >
                  <span className={`avatar avatar--${role.toLowerCase()}`} aria-hidden="true">
                    {ROLE_LABELS[role][0]}
                  </span>
                  <span>
                    <strong>{ROLE_LABELS[role]}</strong>
                    <span className="rolemenu__blurb">{ROLE_BLURBS[role]}</span>
                  </span>
                  {role === actor.role && <Icon name="check" size={18} className="rolemenu__check" />}
                </button>
              </li>
            ))}
          </ul>
          <div className="rolemenu__foot">
            {confirmReset ? (
              <div className="rolemenu__confirm">
                <p>Reset the demo? Your changes are wiped and the original six-month hospital comes back.</p>
                <div className="rolemenu__confirm-actions">
                  <button type="button" className="button button--danger button--small" onClick={reset}>
                    Reset the demo
                  </button>
                  <button type="button" className="button button--ghost button--small" onClick={() => setConfirmReset(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button type="button" className="menu-action" onClick={() => setConfirmReset(true)}>
                  <Icon name="reset" size={18} /> Reset the demo
                </button>
                <button
                  type="button"
                  className="menu-action"
                  onClick={() => {
                    setOpen(false)
                    signOut()
                  }}
                >
                  <Icon name="signout" size={18} /> Sign out
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ThemeToggle() {
  const [theme, setTheme] = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'
  const label = next === 'dark' ? 'Switch to night shift (dark theme)' : 'Switch to day shift (light theme)'
  return (
    <button type="button" className="icon-button" onClick={() => setTheme(next)} aria-label={label} title={label}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  )
}

export default function Shell({ actor, route, children }: { actor: Actor; route: RouteKey; children: ReactNode }) {
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar__inner">
          <a className="brand" href="#hospital" aria-label="WardOS, the hospital view">
            <BrandMark />
            <span className="brand__name">WardOS</span>
          </a>
          <nav className="mainnav" aria-label="Views">
            <NavLinks actor={actor} route={route} variant="top" />
            <a className="navlink navlink--top navlink--quiet" href="#how-it-works">
              <span className="navlink__text">How it works</span>
            </a>
          </nav>
          <div className="topbar__tools">
            <ThemeToggle />
            <RoleMenu actor={actor} />
          </div>
        </div>
      </header>

      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>

      <section className="appfoot" aria-label="About this demo">
        <p>
          Everything on this page runs in your browser: a SQLite database compiled to WebAssembly, saved on this
          device only. The clock is fixed at 09:00 on 1 August 2026, the hospital’s “today”.
        </p>
        <p className="appfoot__links">
          <a href="#how-it-works">How it works</a>
          <a href="#measurements">Measurements</a>
        </p>
      </section>

      <nav className="tabbar" aria-label="Views">
        <NavLinks actor={actor} route={route} variant="tabs" />
      </nav>
    </div>
  )
}
