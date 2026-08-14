# WardOS — design card

The claims the system makes, the mechanisms that enforce them, the mutations that were applied to prove the tests bite, the threat model of a local-first health demo, and the things the system deliberately does not claim. Companion to [ARCHITECTURE.md](ARCHITECTURE.md).

## The five claims

Each claim is enforced by a mechanism, covered by named tests, and **mutation-tested**: the enforcement was deliberately removed, the full suite run, the failing tests recorded, and the mutation reverted. No mutation survived — every claim has live killers today.

| # | Claim | Mechanism | Mutation applied | Killers |
|---|---|---|---|---|
| C1 | Double-booking a bed is structurally impossible | Partial unique index `uq_active_bed` on `admissions(bed_id) WHERE status = 'ACTIVE'` — in the schema, below application code; raw SQL bypassing the engine still can't violate it | Deleted the index line from `src/db/schema.sql` | 4 tests, 3 files — including the raw-SQL bypass probe and the demo-snapshot hash |
| C2 | The event log is sufficient: `replay(events) ≡ state` | Every mutating command appends one event inside the same transaction; replay folds the log into a projection compared to the live DB table-for-table | Reduced the `CHARGE_ADDED` case in `src/core/replay.ts` to a no-op | 4 tests, 3 files — including full six-month equivalence and the CLI `verify` test |
| C3 | Billing direction is right: over-deposit yields a refund, never a negative charge | One balance computation — room total + extras − deposit — with the sign read afterward, not chosen upfront | Flipped the sign of the balance computation in `src/core/billing.ts` | 11 tests, 5 files — golden invoice literals, refund direction, view-model refund labeling, CLI golden bill |
| C4 | Money never floats | Every amount is an integer number of paise end to end; `requirePaise` rejects floats/NaN/unsafe integers at every command boundary, before any transaction opens | Removed the `requirePaise` check from `addCharge` in `src/core/engine.ts` | 2 tests, 1 file — `amountPaise=1.5` and `amountPaise=NaN` must be rejected with no partial state |
| C5 | Permissions are enforced in the command layer, not the interface | Every command checks the actor's role against the permission matrix before touching the database | Removed the `requirePermission` check from `discharge` in `src/core/engine.ts` | 3 tests, 1 file — the exhaustive role × command matrix catches each role that must not discharge |

Each mutation was a temporary edit: apply, run the full suite, record the failing test names, revert, re-run the covering files to confirm green. The killer counts above come from those runs.

## Threat model

WardOS is a local-first demo carrying synthetic health-shaped data. Being precise about what its security machinery does and does not protect matters more here than usual, because "hospital system" invites assumptions.

**What the auth does.** Passwords are bcrypt-hashed (bcryptjs, cost 10 — chosen for acceptable in-browser login latency, and stated as such). Login verification is real (`bcrypt.compareSync` against the stored hash), and every engine command re-checks the actor's role against the permission matrix (C5) — the interface cannot grant what the engine refuses. This protects the *integrity of the demo's rules*: no role can perform a command its role forbids, even by driving the engine directly.

**What the auth does not do.** It does not protect data at rest — the SQLite bytes sit unencrypted in IndexedDB, readable by anyone with access to the browser profile. It does not protect against a networked attacker, because there is no network surface to attack. The demo account passwords are printed on the login screen by design. This is authentication as a structural demonstration, not as a perimeter.

**No network calls — tested, not promised.** After asset load the app makes exactly two fetches, both same-origin and relative: `sql-wasm.wasm` and the `demo.db` snapshot. A test builds the production bundle fresh and scans every `docs/assets/*.js` bundle, every `docs/assets/*.css` stylesheet (a CDN `@font-face`/`@import`/`url(...)` would be exactly the leak worth catching — fonts are self-hosted precisely so this scan stays clean), and `docs/index.html` for any absolute `http(s)://` origin.

The allowlist policy: **verified-inert URL-shaped strings only.** Three prefixes are allowed, each justified in the test file: `http://www.w3.org/…` (XML/SVG namespace *names* React embeds as element-creation constants — identifiers per the XML spec, never dereferenced), `https://react.dev/errors/…` (React's minified-error decoder URL, built into thrown Error message text for a human to read), and `https://rolldown.rs/…` (the bundler's CJS-interop error message, likewise human-read text inside an Error). None of these strings is ever passed to `fetch`, `XMLHttpRequest`, or `WebSocket`.

**Stated limitation:** this is a static scan of the shipped text. It cannot, in principle, catch a URL assembled at runtime from fragments. No such construction exists in this codebase, the app's two runtime fetches are relative by construction, and the dependency surface is small enough to read — but the guarantee the test provides is "no absolute origin appears in the shipped bytes", and it is stated as exactly that.

## Privacy stance

- Nothing leaves the device. Patient records, bills, payroll — all of it lives in a local sql.js database persisted to IndexedDB. There is no server, no analytics, no telemetry, and the bundle scan above is the test backing that sentence.
- Data minimization is schema-enforced where it can be: only the last four digits of any patient ID document are ever stored — `id_last4` is a 4-character column with a `CHECK (length(id_last4) = 4)`, so the full document number has no column to land in.
- Password hashes never enter the event log (see the replay scope decision below), so the append-only audit history contains no secret material.

## Decisions worth recording

**Replay scope: `users` excluded from C2.** `USER_CREATED` events deliberately omit the password and its hash, so the `users` table cannot be rebuilt from the log. That narrows the replay-equivalence claim, and the narrowing is stated rather than fudged: a time machine over hospital *operations* never needs to answer "who could log in at instant T", and keeping secrets out of an append-only log is the right side of that trade.

**IndexedDB eviction.** Browser storage is best-effort; the browser may evict it under pressure. Writes are debounced ~500 ms and flushed on `pagehide`, but the honest framing is: local edits to the demo are durable in the common case, not guaranteed. "Reset demo" always restores the clean seeded hospital, so no failure mode is unrecoverable.

**Frozen-clock demo semantics.** The demo anchors at a fixed instant (2026-08-01T03:30:00.000Z — 09:00 IST) and every command draws time from an injected clock. Published figures are dated, not live; "today" on the site never drifts. This is what makes the seed byte-reproducible, the benchmark rerunnable to an identical JSON, and the time machine meaningful — determinism is a feature, and the cost (the demo does not age) is stated.

## Benchmark methodology, honestly

The three baselines in `src/naive/` are faithful reimplementations of the standard failure modes hospital back-offices are prone to, each run against the identical 1,313-command six-month history and checked against the same truth oracle as the real engine.

- **N1 (float money).** The headline defect is *not* float representation noise. The baseline applies a 2.5% service adjustment that is added and then "removed" — but the removal computes 2.5% of the already-inflated total, so every bill carries an exact ×0.999375 factor (a −0.0625% residue) **in rational arithmetic**, before IEEE representation error even enters. It is an order-of-operations bug that float-typed money invites and integer-paise, single-computation billing removes by construction: there is no running total left standing for a second adjustment to compound against.
- **N2 (occupancy flag).** The oracle is fully faithful and never crashes; the baseline's hand-maintained flag drops its second write on every 7th discharge and every 11th admit. The structural insight: an *accepted double booking* cannot be measured by replaying a valid log — the schema that produced the log never allowed a colliding admit to exist, so the flag's acceptance verdict is never put to a real conflict. What the crash-prone flag actually produces, and what the benchmark counts, is phantom-free beds (a truly occupied bed reading free — the double-booking hazard) and wrongful refusals of genuinely free beds, plus the drift still unresolved at the end of six months.
- **N3 (millisecond dates).** Nights computed as `round((dischargeMs − admitMs) / 86,400,000)` — raw elapsed time, no IST calendar days, no one-night minimum. Day cases round to zero nights; every other stay is off by however far it lands from an exact 24-hour boundary.

The benchmark output is committed JSON (`src/app/data/benchmark.json`), regenerated by `npm run benchmark`; because the seed and baselines are deterministic, regeneration is byte-identical, and the README, the site's Results screen, and this file all read from that one source.

## Non-goals

- **Not an EHR.** No clinical records beyond a diagnosis line; no orders, labs, or medication management.
- **Not multi-user, not multi-facility.** One hospital, one device, one browser profile. There is no sync, and no claim of one.
- **Not medical advice, not a medical device.** It manages beds, bills, payroll, and dispatch — never diagnosis or treatment.
- **Not a hardened deployment.** The auth demonstrates structure (hashing, per-command enforcement); it is not presented as protection against an attacker with device access.
