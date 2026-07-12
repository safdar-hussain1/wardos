package com.healthhaven.service;

import com.healthhaven.domain.Ambulance;
import com.healthhaven.repository.AmbulanceRepository;

import java.time.Clock;
import java.util.List;

/**
 * Dispatches and recalls ambulances.
 *
 * <p>The original's ambulance screen was a read-only table with a BACK button;
 * you could not actually dispatch a vehicle. Dispatch and return are real state
 * transitions here, and the {@code uq_active_dispatch} index stops one ambulance
 * being sent to two places at once.
 */
public final class AmbulanceService {

    private final AmbulanceRepository ambulances;
    private final Clock clock;

    public AmbulanceService(AmbulanceRepository ambulances, Clock clock) {
        this.ambulances = ambulances;
        this.clock = clock;
    }

    public List<Ambulance> fleet() {
        return ambulances.findAll();
    }

    public List<Ambulance> available() {
        return ambulances.findAvailable();
    }

    public long dispatch(long ambulanceId, String destination) {
        Ambulance ambulance = ambulances.findById(ambulanceId)
                .orElseThrow(() -> new IllegalArgumentException("no such ambulance: " + ambulanceId));
        if (!ambulance.isDispatchable()) {
            throw new IllegalStateException(ambulance.vehicleNo() + " is " + ambulance.status()
                    + " and cannot be dispatched");
        }
        return ambulances.openDispatch(ambulanceId, destination, clock.instant());
    }

    public void recall(long ambulanceId) {
        ambulances.closeDispatch(ambulanceId, clock.instant());
    }
}
