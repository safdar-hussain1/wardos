package com.healthhaven.repository;

import com.healthhaven.domain.Admission;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface AdmissionRepository {

    Admission insert(Admission draft);

    Optional<Admission> findById(long id);

    Optional<Admission> findActiveByRoom(String roomNo);

    Optional<Admission> findActiveByPatient(long patientId);

    List<Admission> findActive();

    /** Every stay this patient has ever had, newest first. The original could not answer this at all. */
    List<Admission> findByPatient(long patientId);

    List<Admission> findAll();

    List<Admission> findAdmittedBetween(Instant from, Instant to);

    void markDischarged(long admissionId, Instant dischargedAt);

    /** Same, but on a caller-supplied connection so discharge and invoicing share one transaction. */
    void markDischarged(java.sql.Connection connection, long admissionId, Instant dischargedAt);
}
