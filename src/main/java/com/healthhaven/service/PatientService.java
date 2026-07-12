package com.healthhaven.service;

import com.healthhaven.domain.Gender;
import com.healthhaven.domain.Patient;
import com.healthhaven.repository.PatientRepository;

import java.time.Clock;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

/** Registers and looks up patients. Assigns each a hospital MRN; the ID document is never the key. */
public final class PatientService {

    private final PatientRepository patients;
    private final Clock clock;

    public PatientService(PatientRepository patients, Clock clock) {
        this.patients = patients;
        this.clock = clock;
    }

    public Patient register(String fullName,
                            Gender gender,
                            LocalDate dateOfBirth,
                            String phone,
                            Patient.IdKind idKind,
                            String idLast4) {
        String mrn = patients.nextMrn();
        // id=0 is a placeholder; the repository assigns the real key on insert.
        Patient draft = new Patient(0, mrn, fullName, gender, dateOfBirth, phone,
                idKind, idLast4, clock.instant());
        return patients.insert(draft);
    }

    public Optional<Patient> byMrn(String mrn) {
        return patients.findByMrn(mrn);
    }

    public List<Patient> search(String term) {
        return term == null || term.isBlank() ? patients.findAll() : patients.search(term);
    }

    public List<Patient> all() {
        return patients.findAll();
    }

    public long count() {
        return patients.count();
    }
}
