package com.healthhaven.domain;

import com.healthhaven.validation.Validate;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

/**
 * One hospital stay: a patient, a bed, a clock.
 *
 * <p>Keeping this separate from {@link Patient} is the whole point. Where a
 * patient row <em>is</em> the stay, discharging someone means deleting them —
 * the hospital forgets the patient existed the moment they walk out, and a
 * returning patient is a brand new person with no history. Here, discharge sets
 * {@link #dischargedAt} and the row stays forever.
 */
public final class Admission {

    private final long id;
    private final long patientId;
    private final String roomNo;
    private final long departmentId;
    private final String diagnosis;
    private final Instant admittedAt;
    private final Instant dischargedAt;   // null while active
    private final Money deposit;

    public Admission(long id,
                     long patientId,
                     String roomNo,
                     long departmentId,
                     String diagnosis,
                     Instant admittedAt,
                     Instant dischargedAt,
                     Money deposit) {
        this.id = id;
        this.patientId = patientId;
        this.roomNo = Validate.roomNumber(roomNo);
        this.departmentId = departmentId;
        this.diagnosis = Validate.notBlank(diagnosis, "diagnosis");
        this.admittedAt = Validate.notNull(admittedAt, "admitted at");
        this.deposit = Validate.nonNegativeMoney(deposit, "deposit");
        if (dischargedAt != null && dischargedAt.isBefore(admittedAt)) {
            throw new IllegalArgumentException("discharge time is before admission time");
        }
        this.dischargedAt = dischargedAt;
    }

    public long id() {
        return id;
    }

    public long patientId() {
        return patientId;
    }

    public String roomNo() {
        return roomNo;
    }

    public long departmentId() {
        return departmentId;
    }

    public String diagnosis() {
        return diagnosis;
    }

    public Instant admittedAt() {
        return admittedAt;
    }

    public Optional<Instant> dischargedAt() {
        return Optional.ofNullable(dischargedAt);
    }

    public Money deposit() {
        return deposit;
    }

    public Status status() {
        return dischargedAt == null ? Status.ACTIVE : Status.DISCHARGED;
    }

    public boolean isActive() {
        return dischargedAt == null;
    }

    /**
     * Billable nights between admission and the given instant.
     *
     * <p>Hospitals bill by the night, and a partial night is a night: someone who
     * arrives at 23:00 and leaves at 06:00 the next morning occupied a bed that
     * nobody else could have. So this rounds up, and it never returns zero — a
     * same-day discharge is one night, not free.
     */
    public long billableNights(Instant asOf) {
        Instant end = dischargedAt != null ? dischargedAt : asOf;
        long hours = Duration.between(admittedAt, end).toHours();
        long nights = (hours + 23) / 24;      // ceiling division
        return Math.max(1, nights);
    }

    public Admission dischargedAt(Instant when) {
        return new Admission(id, patientId, roomNo, departmentId, diagnosis, admittedAt, when, deposit);
    }

    public enum Status {
        ACTIVE, DISCHARGED
    }
}
