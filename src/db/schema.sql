CREATE TABLE patients (
  id INTEGER PRIMARY KEY,
  mrn TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('F','M','O')),
  dob TEXT NOT NULL,
  phone TEXT NOT NULL,
  id_last4 TEXT NOT NULL CHECK (length(id_last4) = 4),
  created_at TEXT NOT NULL
);
CREATE TABLE beds (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  ward TEXT NOT NULL CHECK (ward IN ('GENERAL','TWIN','PRIVATE','ICU')),
  rate_paise INTEGER NOT NULL CHECK (rate_paise > 0)
);
CREATE TABLE admissions (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  bed_id INTEGER NOT NULL REFERENCES beds(id),
  diagnosis TEXT NOT NULL,
  deposit_paise INTEGER NOT NULL DEFAULT 0 CHECK (deposit_paise >= 0),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','DISCHARGED')),
  admitted_at TEXT NOT NULL,
  discharged_at TEXT,
  CHECK ((status = 'ACTIVE' AND discharged_at IS NULL)
      OR (status = 'DISCHARGED' AND discharged_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_active_bed ON admissions(bed_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX uq_active_patient ON admissions(patient_id) WHERE status = 'ACTIVE';
CREATE TABLE charges (
  id INTEGER PRIMARY KEY,
  admission_id INTEGER NOT NULL REFERENCES admissions(id),
  kind TEXT NOT NULL CHECK (kind IN ('PROCEDURE','PHARMACY','CONSULTATION','TRANSPORT')),
  description TEXT NOT NULL,
  amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
  charged_at TEXT NOT NULL
);
CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  admission_id INTEGER NOT NULL UNIQUE REFERENCES admissions(id),
  nights INTEGER NOT NULL CHECK (nights >= 1),
  room_rate_paise INTEGER NOT NULL,
  room_total_paise INTEGER NOT NULL,
  extras_total_paise INTEGER NOT NULL,
  deposit_paise INTEGER NOT NULL,
  balance_paise INTEGER NOT NULL,
  issued_at TEXT NOT NULL
);
CREATE TABLE staff (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('DOCTOR','NURSE','TECHNICIAN','DRIVER','ADMIN')),
  department TEXT NOT NULL,
  base_paise INTEGER NOT NULL CHECK (base_paise > 0),
  years_service INTEGER NOT NULL DEFAULT 0,
  specialty TEXT,
  icu_assigned INTEGER NOT NULL DEFAULT 0,
  night_shifts INTEGER NOT NULL DEFAULT 0,
  on_call INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL
);
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','RECEPTION','DOCTOR','NURSE','BILLING')),
  staff_id INTEGER REFERENCES staff(id)
);
CREATE TABLE ambulances (
  id INTEGER PRIMARY KEY,
  plate TEXT NOT NULL UNIQUE,
  model TEXT NOT NULL
);
CREATE TABLE dispatches (
  id INTEGER PRIMARY KEY,
  ambulance_id INTEGER NOT NULL REFERENCES ambulances(id),
  location TEXT NOT NULL,
  admission_id INTEGER REFERENCES admissions(id),
  dispatched_at TEXT NOT NULL,
  returned_at TEXT
);
CREATE UNIQUE INDEX uq_open_dispatch ON dispatches(ambulance_id) WHERE returned_at IS NULL;
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  actor_user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  payload TEXT NOT NULL
);
CREATE TRIGGER events_no_update BEFORE UPDATE ON events
  BEGIN SELECT RAISE(ABORT, 'events is append-only'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events
  BEGIN SELECT RAISE(ABORT, 'events is append-only'); END;
