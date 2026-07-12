package com.healthhaven.repository;

import com.healthhaven.domain.Ambulance;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface AmbulanceRepository {

    Ambulance insert(Ambulance draft);

    Optional<Ambulance> findById(long id);

    List<Ambulance> findAll();

    List<Ambulance> findAvailable();

    void updateStatus(long ambulanceId, Ambulance.Status status);

    long openDispatch(long ambulanceId, String destination, Instant at);

    void closeDispatch(long ambulanceId, Instant returnedAt);
}
