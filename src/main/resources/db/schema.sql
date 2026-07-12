-- Health Haven schema (SQLite).
--
-- Design rules enforced here rather than in application code, because the
-- database is the last line of defence and application code is the first:
--   * money is stored in integer paise, never floating point;
--   * a room can hold at most one ACTIVE admission (partial unique index);
--   * discharging archives an admission, it never deletes a patient;
--   * every mutation is appended to audit_log.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,          -- bcrypt, cost 12
    full_name     TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK (role IN ('ADMIN','DOCTOR','RECEPTIONIST')),
    active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS departments (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL UNIQUE,
    head           TEXT    NOT NULL,
    location       TEXT    NOT NULL,
    specialization TEXT    NOT NULL,
    contact_no     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_code    TEXT    NOT NULL UNIQUE,
    full_name     TEXT    NOT NULL,
    gender        TEXT    NOT NULL CHECK (gender IN ('MALE','FEMALE','OTHER')),
    phone         TEXT    NOT NULL,
    email         TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK (role IN ('DOCTOR','NURSE','TECHNICIAN','DRIVER','ADMIN_STAFF')),
    department_id INTEGER REFERENCES departments(id),
    base_salary   INTEGER NOT NULL CHECK (base_salary >= 0),   -- paise per month
    -- role-specific attributes; null for roles that do not use them
    specialty     TEXT,
    ward          TEXT,
    licence_no    TEXT,
    joined_on     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
    room_no       TEXT PRIMARY KEY,
    room_type     TEXT NOT NULL CHECK (room_type IN ('GENERAL','SEMI_PRIVATE','PRIVATE','ICU')),
    floor         INTEGER NOT NULL CHECK (floor BETWEEN 0 AND 20),
    nightly_rate  INTEGER NOT NULL CHECK (nightly_rate > 0),   -- paise
    out_of_service INTEGER NOT NULL DEFAULT 0 CHECK (out_of_service IN (0,1))
);

-- Patients are people, not admissions. A patient exists once and forever.
CREATE TABLE IF NOT EXISTS patients (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    mrn          TEXT    NOT NULL UNIQUE,     -- medical record number, hospital-issued
    full_name    TEXT    NOT NULL,
    gender       TEXT    NOT NULL CHECK (gender IN ('MALE','FEMALE','OTHER')),
    date_of_birth TEXT   NOT NULL,
    phone        TEXT    NOT NULL,
    id_kind      TEXT    NOT NULL CHECK (id_kind IN ('AADHAAR','VOTER_ID','DRIVING_LICENCE','PASSPORT')),
    id_last4     TEXT    NOT NULL,            -- only the last 4 digits are retained
    registered_at TEXT   NOT NULL
);

-- One row per hospital stay. Discharge closes the row; it never deletes it.
CREATE TABLE IF NOT EXISTS admissions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id    INTEGER NOT NULL REFERENCES patients(id),
    room_no       TEXT    NOT NULL REFERENCES rooms(room_no),
    department_id INTEGER NOT NULL REFERENCES departments(id),
    diagnosis     TEXT    NOT NULL,
    admitted_at   TEXT    NOT NULL,
    discharged_at TEXT,                        -- NULL while the stay is active
    deposit       INTEGER NOT NULL CHECK (deposit >= 0),  -- paise
    status        TEXT    NOT NULL CHECK (status IN ('ACTIVE','DISCHARGED')),
    CHECK ((status = 'ACTIVE'  AND discharged_at IS     NULL)
        OR (status = 'DISCHARGED' AND discharged_at IS NOT NULL))
);

-- The bug the original could not prevent: two patients in one bed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_room
    ON admissions(room_no) WHERE status = 'ACTIVE';

-- A patient cannot be admitted twice at once either.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_patient
    ON admissions(patient_id) WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS ix_admissions_patient ON admissions(patient_id);
CREATE INDEX IF NOT EXISTS ix_admissions_admitted ON admissions(admitted_at);

-- Chargeable events attached to a stay. Room charges are derived at billing
-- time from length of stay; these are the discrete extras.
CREATE TABLE IF NOT EXISTS charges (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    admission_id INTEGER NOT NULL REFERENCES admissions(id),
    kind         TEXT    NOT NULL CHECK (kind IN ('PROCEDURE','CONSULTATION','PHARMACY','AMBULANCE')),
    description  TEXT    NOT NULL,
    quantity     INTEGER NOT NULL CHECK (quantity > 0),
    unit_amount  INTEGER NOT NULL CHECK (unit_amount >= 0),   -- paise
    incurred_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_charges_admission ON charges(admission_id);

CREATE TABLE IF NOT EXISTS invoices (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    admission_id  INTEGER NOT NULL UNIQUE REFERENCES admissions(id),
    issued_at     TEXT    NOT NULL,
    nights        INTEGER NOT NULL CHECK (nights >= 1),
    room_total    INTEGER NOT NULL CHECK (room_total >= 0),
    extras_total  INTEGER NOT NULL CHECK (extras_total >= 0),
    gross_total   INTEGER NOT NULL CHECK (gross_total >= 0),
    deposit       INTEGER NOT NULL CHECK (deposit >= 0),
    balance_due   INTEGER NOT NULL,           -- may be negative => refund owed
    settled       INTEGER NOT NULL DEFAULT 0 CHECK (settled IN (0,1))
);

CREATE TABLE IF NOT EXISTS ambulances (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_no   TEXT    NOT NULL UNIQUE,
    driver_name  TEXT    NOT NULL,
    driver_phone TEXT    NOT NULL,
    status       TEXT    NOT NULL CHECK (status IN ('AVAILABLE','DISPATCHED','MAINTENANCE')),
    base_location TEXT   NOT NULL
);

CREATE TABLE IF NOT EXISTS dispatches (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ambulance_id  INTEGER NOT NULL REFERENCES ambulances(id),
    destination   TEXT    NOT NULL,
    dispatched_at TEXT    NOT NULL,
    returned_at   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_dispatch
    ON dispatches(ambulance_id) WHERE returned_at IS NULL;

-- Append-only. Nothing in this table is ever updated or deleted.
CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    at          TEXT NOT NULL,
    actor       TEXT NOT NULL,
    action      TEXT NOT NULL,
    entity      TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    detail      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_audit_at ON audit_log(at);
