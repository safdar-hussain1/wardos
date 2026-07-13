# OOP design notes

It is easy to write a "hospital system" in which the only act of object-oriented programming is
extending a window class so that the windows are windows. Each screen opens its own database
connection, writes its own SQL, and does its own arithmetic in a button handler; there is no
`Patient` type, and a patient's name exists as a `String` in a text field and, briefly, inside an
`INSERT`.

This document maps each principle to the class that earns it here — and, in each case, to what
goes wrong without it. The test named beside each one is the proof it works.

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
paise, that cannot be constructed from a malformed string without an exception. Store money as a
`VARCHAR` and parse it with `Integer.parseInt` at the moment of use, and a deposit of `"3,000"`
crashes whichever screen touches it.

## Encapsulation

- **`Money`** is immutable. `plus`, `minus`, `times` return new instances and overflow-check with
  `Math.addExact`. There is no way to reach the underlying `long` and corrupt it.
- **`User`** has no getter for its password hash. Nothing above the repository layer can read it,
  log it, or accidentally drop it into a Swing table model. You cannot leak what you cannot reach.
- **`Room` does not have an `isOccupied` field.** This is the important one. Keep an `Availability`
  column on the room and every screen that admits or discharges has to remember to update it, so
  "Occupied" becomes a *claim* that drifts out of step with reality. Occupancy is not state a
  `Room` owns; it is a fact derived from whether an `ACTIVE` `Admission` points at it.
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

This is the seam that matters most. Without it, the bill is one expression written inline in an
action listener — `Integer.parseInt(price) - Integer.parseInt(deposit)` — where `price` is one
night's rate and the length of stay appears nowhere. There is no object whose job is to know what
a stay cost, so nothing can be wrong in one place and fixed in one place.
*(`AdmissionBillingTest`, `NaiveApproachComparisonTest$Billing`)*

## Composition over inheritance, where inheritance is wrong

An `Admission` is not a kind of `Patient`, and a `Patient` is not a kind of `Admission`. Conflate
them — let the patient row *be* the stay — and discharging someone necessarily means deleting
them. Here they are separate objects in a relationship: a `Patient` exists once, permanently; an
`Admission` is one stay, referencing a patient and a room. Discharge closes the admission and
leaves the person alone.

`Invoice` is composed of `BillableItem`s rather than inheriting from anything, and services are
composed of the repositories they need, injected as interfaces.

## Interfaces and dependency inversion

The service layer depends on `PatientRepository`, `AdmissionRepository`, `RoomRepository` and so on
— *interfaces* — never on the JDBC classes that implement them. The domain layer knows nothing about
SQL at all; it does not import `java.sql`. This is what makes the domain testable without a
database and what would make swapping SQLite for Postgres a change confined to one package.

## Single responsibility

"Add a new patient" is the operation that tempts you to put everything in one class: build a
form, open a connection, query the room list, write two statements as concatenated SQL, show a
dialog. Six responsibilities, none of them testable.

Here: `MainWindow` collects input, `AdmissionService.admit` enforces the rules (is the room
bookable, is it free, is the patient already admitted) inside one transaction,
`AdmissionRepository` writes it, and the database's unique index guarantees the invariant even if
every layer above it has a bug.
