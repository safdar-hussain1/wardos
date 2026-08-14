import type { Db } from '../db/database'

/**
 * The hospital's fixed physical layout: four wards, 32 beds total. Bed
 * labels are deterministic — `${prefix}-${index padded to 2 digits}`, e.g.
 * `G-01` … `G-14`, `T-01` … `T-08`, `P-01` … `P-06`, `I-01` … `I-04`.
 */
export const WARD_CONFIG = [
  { ward: 'GENERAL', count: 14, ratePaise: 150000, prefix: 'G' },
  { ward: 'TWIN', count: 8, ratePaise: 280000, prefix: 'T' },
  { ward: 'PRIVATE', count: 6, ratePaise: 500000, prefix: 'P' },
  { ward: 'ICU', count: 4, ratePaise: 950000, prefix: 'I' },
] as const // labels G-01…, 32 beds total

export const DEMO_ACCOUNTS = [
  { username: 'admin', password: 'wardos-admin', role: 'ADMIN' },
  { username: 'reception', password: 'wardos-desk', role: 'RECEPTION' },
  { username: 'dr.rao', password: 'wardos-rounds', role: 'DOCTOR' },
  { username: 'nurse.k', password: 'wardos-ward', role: 'NURSE' },
  { username: 'billing', password: 'wardos-desk2', role: 'BILLING' },
] as const

/**
 * Demo salts (fixed for reproducible demo database).
 *
 * bcryptjs's default salt generation pulls from a CSPRNG, so
 * `bcrypt.hashSync(pw, 10)` produces a *different* hash every run even for
 * the same password — which would make `db.serialize()` differ byte-for-byte
 * between two otherwise-identical seed runs. These five salts were
 * precomputed once via `bcrypt.genSaltSync(10)` and are pinned one-per-demo-
 * account (in `DEMO_ACCOUNTS` order) by `seed.ts`, so hashing is
 * deterministic while still producing a real, verifiable bcrypt hash
 * (`bcrypt.compareSync` against the plaintext password still works).
 */
export const DEMO_SALTS = [
  '$2a$10$4dwqymDhhQKvTDKzRzfGru',
  '$2a$10$0kPum0wpRXfSUE5tFdgX3e',
  '$2a$10$Q8OgOfmIqnQgzhJOK8ACQu',
  '$2a$10$baPRhA03xKEb8P0tswvz5.',
  '$2a$10$Bvc6z8camvA06ypJIY85oO',
] as const

const AMBULANCES = [
  { plate: 'WD-AMB-01', model: 'Force Traveller' },
  { plate: 'WD-AMB-02', model: 'Tata Winger' },
  { plate: 'WD-AMB-03', model: 'Mahindra Bolero Ambulance' },
  { plate: 'WD-AMB-04', model: 'Force Traveller' },
] as const

/**
 * Inserts the 32 config beds and 4 ambulances via raw SQL.
 *
 * Beds and ambulances are facility config, not domain events — there is no
 * BED_ADDED/AMBULANCE_ADDED action (see replay.ts's `BedRow` doc comment:
 * "beds are static seed data, never event-sourced") — so, unlike every
 * other seed action, this bypasses the Engine and writes the tables
 * directly. It must run before any Engine command that references a bed or
 * ambulance id (admit, dispatchAmbulance).
 */
export function insertFacility(db: Db): void {
  for (const w of WARD_CONFIG) {
    for (let i = 1; i <= w.count; i++) {
      const label = `${w.prefix}-${String(i).padStart(2, '0')}`
      db.run(`INSERT INTO beds (label, ward, rate_paise) VALUES (?,?,?)`, [label, w.ward, w.ratePaise])
    }
  }
  for (const a of AMBULANCES) {
    db.run(`INSERT INTO ambulances (plate, model) VALUES (?,?)`, [a.plate, a.model])
  }
}
