package com.healthhaven.domain;

import com.healthhaven.validation.Validate;

/**
 * A room, as the hospital's estate knows it: a number, a category and a tariff.
 *
 * <p>Note what is <em>not</em> here: occupancy. The original stored an
 * {@code Availability} column on the room and updated it by hand from three
 * different screens, so "Occupied" was a claim rather than a fact and drifted
 * out of step with the patient table constantly. Occupancy is derived from the
 * admissions table instead — a room is occupied if and only if an ACTIVE
 * admission points at it, and a partial unique index makes two impossible.
 */
public final class Room {

    private final String roomNo;
    private final RoomType type;
    private final int floor;
    private final Money nightlyRate;
    private final boolean outOfService;

    public Room(String roomNo, RoomType type, int floor, Money nightlyRate, boolean outOfService) {
        this.roomNo = Validate.roomNumber(roomNo);
        this.type = Validate.notNull(type, "room type");
        this.floor = Validate.range(floor, 0, 20, "floor");
        this.nightlyRate = Validate.positiveMoney(nightlyRate, "nightly rate");
        this.outOfService = outOfService;
    }

    public static Room standard(String roomNo, RoomType type, int floor) {
        return new Room(roomNo, type, floor, type.standardNightlyRate(), false);
    }

    public String roomNo() {
        return roomNo;
    }

    public RoomType type() {
        return type;
    }

    public int floor() {
        return floor;
    }

    public Money nightlyRate() {
        return nightlyRate;
    }

    public boolean outOfService() {
        return outOfService;
    }

    /** True when the room may take an admission at all, regardless of who is in it. */
    public boolean isBookable() {
        return !outOfService;
    }

    @Override
    public String toString() {
        return roomNo + " (" + type.label() + ", " + nightlyRate.format() + "/night)";
    }
}
