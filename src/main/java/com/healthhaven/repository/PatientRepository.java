package com.healthhaven.repository;

import com.healthhaven.domain.Patient;

import java.util.List;
import java.util.Optional;

public interface PatientRepository {

    /** Persists a new patient and returns it with its assigned id and MRN. */
    Patient insert(Patient draft);

    Optional<Patient> findById(long id);

    Optional<Patient> findByMrn(String mrn);

    List<Patient> findAll();

    /** Name or MRN, case-insensitive, matched anywhere in the field. */
    List<Patient> search(String term);

    long count();

    /** The next free MRN, e.g. "HH-000042". */
    String nextMrn();
}
