# OOP design notes

The original was an object-oriented programming project that contained, in the end, one act of
object-oriented programming: twelve classes extending `JFrame` so that they would be windows.
Every one of them opened its own database connection, wrote its own SQL, and did its own
arithmetic inside a button handler. There was no `Patient` type. A patient's name existed as a
`String` in a `JTextField` and, briefly, inside a concatenated `INSERT`.

This document maps each principle to the class that earns it here. The test named beside each
one is the proof it works.

---

## Abstraction

**`Person` (sealed abstract)** — what the hospital knows about any human being: an id, a name,
a gender, a phone number. It declares two things it cannot answer for itself:

```java
public abstract String displayName();   // "Dr. Meera Iyer" | "Anil Rao (HH-000031)"
public abstract String reference();     // a staff code | a medical record number
```

It is `sealed`, permitting only `Patient` and `StaffMember`, so the set of people the system
recognises is closed and can be reasoned about exhaustively.

`Money` is the other abstraction that pulls its weight: an amount of rupees, held as integral
paise, that cannot be constructed from a malformed string without an exception. In the original,
money was a `VARCHAR` column parsed with `Integer.parseInt` at the moment of use — so a deposit
of `"3,000"` crashed whichever screen touched it.

## Encapsulation

- **`Money`** is immutable. `plus`, `minus`, `times` return new instances and overflow-check with
  `Math.addExact`. There is no way to reach the underlying `long` and corrupt it.
- **`User`** has no getter for its password hash. Nothing above the repository layer can read it,
  log it, or accidentally drop it into a Swing table model. The original stored passwords in plain
  text and compared them by pasting them into a SQL string.
- **`Room` does not have an `isOccupied` field.** This is the important one. The original kept an
  `Availability` column on the room and updated it by hand from three different screens, so
  "Occupied" was a *claim* that drifted out of step with the patient table. Occupancy is not state
  a `Room` owns; it is a fact derived from whether an `ACTIVE` `Admission` points at it.
- Every domain constructor validates through `Validate` and throws `ValidationException`. An object
  cannot exist in an invalid state, so no code downstream has to wonder whether it is.

## Inheritance

`StaffMember` is an abstract class holding what all staff share — a staff code, a department, a
base salary, a joining date — and leaving to its subclasses what differs:

```java
public abstract StaffRole role();
public abstract Money monthlyPay();
public abstract String allowanceNote();
```

```
Person (sealed abstract)
├── Patient
└── StaffMember (sealed abstract)
    ├── Doctor       base + 30% specialty (+10% after 5 years' service)
    ├── Nurse        base + 20% if a critical ward, else + 8%
    ├── Technician   base + 12% equipment
    ├── Driver       base + ₹3,000 flat travel allowance
    └── AdminStaff   base
```

Shared constructor work happens once in `StaffMember`; a `Doctor` adds only its specialty. The
`Profile` record carries the common fields so that each subclass constructor names only what is
special about it.

## Polymorphism

Two places where it does real work, rather than being demonstrated for a marker.

**Payroll.** `StaffService.monthlyPayroll` sums a mixed list and never asks what anything is:

```java
public Money monthlyPayroll(List<StaffMember> staff) {
    return staff.stream()
            .map(StaffMember::monthlyPay)     // Doctor? Nurse? Driver? Doesn't matter.
            .reduce(Money.ZERO, Money::plus);
}
```

A `Driver`'s allowance is a flat rupee amount and a `Doctor`'s is a percentage that depends on
years of service. The two are computed by completely different code, and the caller is indifferent.
Adding a `Pharmacist` tomorrow means writing one class and touching nothing else.
*(`PayrollPolymorphismTest`)*

**Billing.** `Invoice` totals a `List<BillableItem>`:

```java
public Money grossTotal() {
    return lines.stream().map(BillableItem::lineTotal).reduce(Money.ZERO, Money::plus);
}
```

A `RoomCharge` computes itself as nights × the room's nightly rate. An `ExtraCharge` (a scan, a
consult, a drug, an ambulance ride) is a quantity × a unit price recorded against the stay. Both
are `BillableItem`s; the invoice adds them up without distinguishing.

This is exactly the seam the original lacked. Its bill was one expression, written inline in a
Swing action listener — `Integer.parseInt(price) - Integer.parseInt(deposit)` — where `price` was
one night's rate and length of stay appeared nowhere. There was no object whose job was to know
what a stay cost, so nothing could be wrong in one place and fixed in one place.
*(`AdmissionBillingTest`, `LegacyBugReproductionTest$Billing`)*

## Composition over inheritance, where inheritance is wrong

An `Admission` is not a kind of `Patient`, and a `Patient` is not a kind of `Admission` — the
original conflated them, which is precisely why discharging someone ran
`delete from Patient_Info`. Here they are separate objects in a relationship: a `Patient` exists
once, permanently; an `Admission` is one stay, referencing a patient and a room. Discharge closes
the admission and leaves the patient alone.

`Invoice` is composed of `BillableItem`s rather than inheriting from anything, and services are
composed of the repositories they need, injected as interfaces.

## Interfaces and dependency inversion

The service layer depends on `PatientRepository`, `AdmissionRepository`, `RoomRepository` and so on
— *interfaces* — never on the JDBC classes that implement them. The domain layer knows nothing about
SQL at all; it does not import `java.sql`. This is what makes the domain testable without a
database and what would make swapping SQLite for Postgres a change confined to one package.

## Single responsibility

The original's `AddNewPatient.java` was 169 lines that built a form, opened a database connection,
queried the room list, validated nothing, wrote two `INSERT`/`UPDATE` statements as concatenated
SQL, and showed a dialog. Six responsibilities in one class, none of them testable.

The same operation now: `MainWindow` collects input, `AdmissionService.admit` enforces the rules
(is the room bookable, is it free, is the patient already admitted) inside one transaction,
`AdmissionRepository` writes it, and the database's unique index guarantees the invariant even if
every layer above it has a bug.
