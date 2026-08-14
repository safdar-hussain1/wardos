# WardOS — architecture

WardOS is one TypeScript engine over one SQLite schema, driven from three surfaces: a browser SPA, a Node CLI, and a headless test harness. This document explains the layering, the event log, the transaction discipline, the schema-level invariants, why every run is deterministic, and how the browser runtime works.

## Layering

```
src/
├── core/    pure domain, no I/O of its own: money, clock, events, engine
│            (commands: admit/discharge/transfer/charge/deposit/dispatch/…),
│            billing, payroll (staff), permissions, replay, rng
├── db/      schema.sql, the sql.js adapter, transactions
├── seed/    the deterministic six-month demo hospital (emits commands, not rows)
├── naive/   the three benchmark baselines — faithful reimplementations of the
│            standard failure modes, imported only by the benchmark
├── bench/   benchmark harness + truth oracle
├── cli/     Node CLI over the engine (seed | beds | report | bill | verify | export | snapshot)
└── app/     React SPA — renders engine state, issues engine commands
```

Dependencies point downward only. `core/` imports nothing from the layers above it; the engine receives a `Db` and a `Clock` at construction and never reaches for a global. `app/`, `cli/`, and `tests/` sit side by side at the top — none of them contains a business rule. The React app in particular carries no billing math, no permission checks, no double-booking logic: a rule that exists only in a component is, by definition, a bug. `naive/` is deliberately quarantined — nothing outside `bench/` imports it.

## The event log and replay

Every state-changing command appends exactly one row to `events` — actor, action, entity, payload JSON, and the injected clock's timestamp — **inside the same transaction** as the mutation itself. If the command fails, neither the mutation nor the event lands; there is no path where state changes without a matching event or an event describes a change that didn't happen.

The table is append-only at the schema level: `BEFORE UPDATE` and `BEFORE DELETE` triggers raise on any attempt. The audit trail screen, the time machine, and claim C2 all read from this one table.

`replay(events, beds)` (in `src/core/replay.ts`) folds the log into a plain-object projection of the operational tables — patients, admissions, charges, invoices, dispatches, staff — and a test asserts that projection equals the live database table for table, id for id, field for field, after the full six-month seed. The time machine is the same fold stopped at an earlier instant: read-only by construction, a projection that never touches the live DB.

**Replay scope: `users` is excluded, deliberately.** Password hashes never enter the event log — `USER_CREATED`'s payload omits the password and its hash — so the `users` table cannot be reconstructed from history, and doesn't need to be: a time-machine snapshot of the hospital's operations never has to answer "who could log in at instant T". Excluding secrets from the log is the correct trade even though it narrows C2's scope, and the scope is stated rather than fudged. Beds are also supplied to `replay` as an argument rather than folded from events: they are static seed configuration (there is no `BED_ADDED` action), not history.

## Transactions

Every command runs through one funnel, `runCommand`, which wraps the work in `Db.inTransaction`:

- **`BEGIN IMMEDIATE`** — the write lock is taken up front, not lazily at first write, so a command never gets partway through reads before discovering it must fail.
- **All paths safe.** On success, `COMMIT`. On any throw, `ROLLBACK` — and if the rollback itself throws, that error is swallowed so the original cause is what surfaces, while a `finally` still resets the transaction depth counter. A failed rollback can never wedge the connection into a permanent "inside a transaction" state.
- **No nesting.** A nested `inTransaction` call throws immediately rather than silently flattening — every command is exactly one transaction.
- **Validation before the transaction.** Boundary checks like `requirePaise` (money must be a non-negative safe integer) and `requirePermission` (C5) run before `BEGIN`, so an invalid input never opens a transaction, never produces a partial mutation, and never appends an event.
- **Errors classified, not leaked.** A raw SQLite `UNIQUE`/`CHECK` failure is translated into a human-readable rule violation naming the constraint; `NOT NULL`/`FOREIGN KEY` failures — which indicate engine bugs, not user-facing rules — propagate unchanged.

`PRAGMA foreign_keys = ON` is set on every connection open, because SQLite defaults it off per connection.

## Schema invariants

The invariants that matter most are enforced in `src/db/schema.sql` itself, below application code — they hold even against raw SQL that bypasses the engine (and a test performs exactly that bypass):

| Invariant | Mechanism |
|---|---|
| One ACTIVE admission per bed (no double booking) | `CREATE UNIQUE INDEX uq_active_bed ON admissions(bed_id) WHERE status = 'ACTIVE'` |
| One ACTIVE admission per patient | `uq_active_patient`, same pattern on `patient_id` |
| One open dispatch per ambulance | `uq_open_dispatch ON dispatches(ambulance_id) WHERE returned_at IS NULL` |
| ACTIVE ⇔ no discharge time, DISCHARGED ⇔ has one | table-level `CHECK` enforcing the exclusive-or |
| Events are append-only | `BEFORE UPDATE` / `BEFORE DELETE` triggers that `RAISE(ABORT)` |
| One invoice per admission | `UNIQUE` on `invoices.admission_id` |
| A stay is at least one night | `CHECK (nights >= 1)` on `invoices` |
| Money is never negative where it can't be | `CHECK (amount_paise >= 0)`, `CHECK (deposit_paise >= 0)`, `CHECK (rate_paise > 0)` |
| Only the last 4 digits of an ID document exist | `CHECK (length(id_last4) = 4)` — the column *is* the truncation |

Occupancy is derived — a bed is occupied because an ACTIVE admission points at it. There is no occupancy flag anywhere in the schema, which is precisely the failure mode benchmark baseline N2 exists to demonstrate.

## Determinism

Every published number is reproducible to the byte because nothing in the engine, seed, or benchmark ever consults ambient state:

- **Injected clock.** No `Date.now()` in core, seed, naive, or CLI code — a `Clock` is injected everywhere, and a dedicated test file scans the source to keep it that way. The demo anchors at `ANCHOR_ISO = 2026-08-01T03:30:00.000Z` (09:00 IST).
- **Seeded PRNG.** The seed generator draws from `mulberry32` with a fixed seed — same sequence, every run, every machine.
- **Commands, not rows.** The seed emits engine commands rather than inserting rows, so six months of history exercises the entire engine and its event log — and seeding twice produces byte-identical databases (verified by SHA-256 in a test, and independently by hashing two fresh seeds from separate processes).
- **Pinned bcrypt salts.** bcryptjs normally draws salts from a CSPRNG, which would make the demo accounts' password hashes — and therefore the database bytes — differ every run. During seeding, `bcrypt.hashSync` is pinned to a fixed salt list, then restored in a `finally`; `compareSync` is untouched, so login verification is the real thing. A reentrancy guard throws if two seeds ever overlap the patch (which would interleave their salt cursors), making the failure loud instead of silent.

## Browser runtime

The browser runs the same sql.js (SQLite compiled to WASM) engine as Node — the two runtime fetches the app ever makes are both same-origin and relative: `sql-wasm.wasm` and the `demo.db` snapshot.

- **Boot.** The app first tries IndexedDB for a previously persisted database; if none exists (first visit, or after "Reset demo"), it fetches the committed `demo.db` snapshot — a fully seeded hospital, so the first paint is already populated. A test pins the committed snapshot's SHA-256 to a freshly seeded database's, so the snapshot can never silently go stale against the seed code.
- **Persistence.** After each dispatched command the serialized database is scheduled for a write to IndexedDB, debounced ~500 ms so a burst of UI interaction coalesces into one write. On `pagehide` (and on the page becoming hidden) the pending write is flushed immediately, so closing the tab inside the debounce window doesn't drop the latest commands — best-effort by nature, since a pagehide handler cannot await, but browsers let an IndexedDB write started there run to completion.
- **Eviction honesty.** IndexedDB is browser-managed storage and may be evicted under storage pressure. That limitation is stated in the product, not hidden: "Reset demo" always restores a clean seeded hospital, so the worst case is losing local demo edits, never an unrecoverable state.

## One engine, three surfaces

The SPA, the CLI, and the test suite import the same `Engine` class over the same `schema.sql`. The CLI (`bin/wardos.mjs`) runs the TypeScript sources through vite-node — the same module resolution and transform the test runner uses — so there is no second build pipeline that could drift.

The parity is pinned, not assumed: `src/app/data/golden-bill.json` freezes one seeded invoice (admission 1 — nights, room total, four charge lines, deposit, refund), and both `wardos bill 1` on the CLI and the in-page `?selftest=1` check are asserted against it byte-for-byte on the numbers. If the browser and the CLI ever computed a bill differently, two tests would say so by name.
