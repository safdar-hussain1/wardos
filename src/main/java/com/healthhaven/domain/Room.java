package com.healthhaven.domain;

import com.healthhaven.validation.Validate;

/**
 * A room, as the hospital's estate knows it: a number, a category and a tariff.
 *
 * <p>Note what is <em>not</em> here: occupancy. Storing an {@code Availability}
 * column on the room means every screen that admits or discharges has to
 * remember to update it, so "Occupied" becomes a claim rather than a fact and
 * drifts out of step with reality. Occupancy is derived from the admissions
 * table instead — a room is occupied if and only if an ACTIVE admission points
 * at it, and a partial unique index makes two of those impossible.
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
