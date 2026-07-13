package com.healthhaven.domain;

import com.healthhaven.validation.Validate;

/**
 * An ambulance in the fleet.
 *
 * <p>Dispatching is a real operation, not a status column somebody edits: a
 * unique index on open dispatches stops the same vehicle being sent to two
 * emergencies at once.
 */
public final class Ambulance {

    private final long id;
    private final String vehicleNo;
    private final String driverName;
    private final String driverPhone;
    private final Status status;
    private final String baseLocation;

    public Ambulance(long id, String vehicleNo, String driverName, String driverPhone,
                     Status status, String baseLocation) {
        this.id = id;
        this.vehicleNo = Validate.notBlank(vehicleNo, "vehicle number");
        this.driverName = Validate.name(driverName, "driver name");
        this.driverPhone = Validate.phone(driverPhone);
        this.status = Validate.notNull(status, "status");
        this.baseLocation = Validate.notBlank(baseLocation, "base location");
    }

    public long id() {
        return id;
    }

    public String vehicleNo() {
        return vehicleNo;
    }

    public String driverName() {
        return driverName;
    }

    public String driverPhone() {
        return driverPhone;
    }

    public Status status() {
        return status;
    }

    public String baseLocation() {
        return baseLocation;
    }

    public boolean isDispatchable() {
        return status == Status.AVAILABLE;
    }

    public Ambulance withStatus(Status newStatus) {
        return new Ambulance(id, vehicleNo, driverName, driverPhone, newStatus, baseLocation);
    }

    public enum Status {
        AVAILABLE, DISPATCHED, MAINTENANCE
    }
}
