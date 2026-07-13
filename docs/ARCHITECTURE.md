# Architecture

## Layers

```
  ui/ (Swing)        cli/            web/ (JSON API)
        └───────────────┼───────────────┘
                    service/          business rules · permissions · transactions
                        │
                   repository/        interfaces
                        │
                repository/jdbc/      PreparedStatement implementations
                        │
                      db/             connections, transactions, migration, demo data
                        │
                    domain/           entities, value objects, hierarchies — no java.sql
```

Dependencies point one way only. `domain` imports nothing from the layers above it and does not
know a database exists, which is why it can be tested without one. The three surfaces are
interchangeable: each is a thin adapter over the same services, and none of them contains a rule.

Contrast with the original, which had no layers at all. Each of its twelve `JFrame` subclasses
was its own vertical slice — UI, SQL, and arithmetic in one file — so the same logic was written
several times, slightly differently, and a fix in one screen did not reach the others.

## Persistence

**SQLite, embedded.** The original needed a running MySQL server, a schema you had to rebuild by
hand from the screenshots in the report, and the author's own root password — which is why nobody
else could actually run it. Here the database is a file, the schema is created on first open from
`resources/db/schema.sql`, and demo data loads if the tables are empty. `mvn package && java -jar`
gets you a populated hospital.

**Connections.** `Database.open()` returns a fresh connection with `PRAGMA foreign_keys = ON` —
SQLite defaults foreign keys *off*, per connection, so a schema's `REFERENCES` clauses are
decoration unless every connection says otherwise. Connections are opened per unit of work and
closed by try-with-resources. The original constructed `new Connect()` inside every button handler
and never closed one, leaking a connection per click.

**Transactions.** `Database.inTransaction` commits on success and rolls back on any exception:

```java
db.inTransaction(connection -> {
    long id = admissions.insert(connection, draft);
    audit.record(connection, actor, "ADMIT", "admission", id);
    return id;
});
```

Admitting a patient inserts an admission *and* writes an audit entry; discharging closes the
admission *and* issues the invoice. Each is one transaction. The original ran its two statements
as two separate auto-committed round trips, so if the second failed the first still stood — a
patient in a bed the system believed was empty.

## Invariants in the schema

The rules that must never break are enforced where they cannot be bypassed, because application
code is the first line of defence and the database is the last.

| Invariant | Mechanism |
|---|---|
| One active admission per room | `CREATE UNIQUE INDEX uq_active_room ON admissions(room_no) WHERE status='ACTIVE'` |
| One active admission per patient | `CREATE UNIQUE INDEX uq_active_patient ON admissions(patient_id) WHERE status='ACTIVE'` |
| An admission is active xor discharged | `CHECK ((status='ACTIVE' AND discharged_at IS NULL) OR (status='DISCHARGED' AND discharged_at IS NOT NULL))` |
| One ambulance, one open dispatch | `CREATE UNIQUE INDEX uq_active_dispatch ON dispatches(ambulance_id) WHERE returned_at IS NULL` |
| Money is exact | every amount is `INTEGER` paise, with `CHECK (... >= 0)` where it cannot be negative |
| A stay is billed at least one night | `CHECK (nights >= 1)` on `invoices` |

The partial unique indexes are the interesting ones: they are what make F4 (two patients in one
bed) structurally impossible rather than merely unlikely. A room is occupied *because* an active
admission points at it — occupancy is a query, not a column somebody remembered to update.

## Security

- **Parameterised SQL everywhere.** Every statement in `repository/jdbc` goes through a
  `PreparedStatement`. There is deliberately no helper in `Sql` that takes a fragment and a value
  and concatenates them, because the moment one exists somebody will use it.
- **bcrypt (cost 12)** for passwords, via `at.favre.lib:bcrypt`. `AuthService.authenticate` looks
  the user up by username and verifies the hash; a wrong password and a nonexistent user are
  indistinguishable to the caller.
- **Role-based permissions** checked in the service layer, not the UI. `Role` maps to a
  `Set<Permission>`, and `AuthService.require(user, permission)` throws if it is absent. Disabling
  a button is a courtesy; the check behind it is the control.
- **Minimal identity data.** The original keyed the patient table on whatever government ID was
  typed into the form — the Aadhaar number was the join key across the database. Here the primary
  key is a hospital-issued MRN and only the last four digits of the ID document are retained,
  enough to confirm which card was seen and not enough to be worth stealing.
- **The API is not open.** It serves patient names, MRNs and diagnoses, so it binds to loopback
  only, requires a bearer token on every `/api` route (compared in constant time, because a
  compare that returns early leaks the token one character at a time), and sends no
  `Access-Control-Allow-Origin` header — an earlier draft sent `*`, which would have let any web
  page the operator happened to visit read the ward list.
- **Append-only audit log.** Every mutation records actor, action, entity, id and timestamp.
  Nothing in `audit_log` is ever updated or deleted. The original had no audit trail at all, which
  is how a `DELETE` on discharge went unnoticed.

## Billing

`BillingService.priceStay(admission, room, extras, asOf)` builds an `Invoice` from:

- a `RoomCharge` — `billableNights × room.nightlyRate()`, where nights round *up* and are never
  zero (a patient who arrives at 23:00 and leaves at 06:00 occupied a bed nobody else could have);
- the stay's `ExtraCharge`s — procedures, consultations, pharmacy, ambulance;
- the deposit, subtracted at the end.

A negative balance is surfaced as an explicit **refund**, not printed as a negative number in a box
labelled "Pending Amount" and left for the desk clerk to interpret.

Invoices are **frozen at discharge**: totals are computed once and stored. A bill that silently
changes after the patient has paid it is not a bill. `quote()` gives the live running total for a
stay still in progress; `discharge()` issues the invoice.

## The `legacy/` package

`LegacyHospital` reproduces the original's login, admission, billing and discharge logic exactly —
concatenated SQL, the `roomRate − deposit` formula, `DELETE` on discharge, no transaction. It is
production code, not test code, so the audit can be run from the shipped jar
(`java -jar health-haven.jar audit`) and the comparison is reproducible by anyone.

It is never wired into the application. Nothing outside `report/AuditReport` and the audit tests
imports it.
