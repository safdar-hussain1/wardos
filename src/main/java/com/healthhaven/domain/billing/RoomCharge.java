package com.healthhaven.domain.billing;

import com.healthhaven.domain.Money;
import com.healthhaven.domain.Room;

/**
 * Room and board for a stay: nights × the room's nightly rate.
 *
 * <p>This one line is the fix for the original's worst bug. {@code
 * Update_Patient_Details.java} computed what it called the pending amount as
 * {@code Integer.parseInt(room.Price) - Integer.parseInt(deposit)} — the room's
 * <em>nightly</em> rate minus the deposit, with the length of stay nowhere in
 * the expression. A three-week ICU stay and an overnight stay in the same bed
 * produced the same bill, and any deposit larger than one night's rate produced
 * a negative "pending amount", which the screen happily displayed as though the
 * hospital owed the patient money.
 */
public final class RoomCharge implements BillableItem {

    private final String roomNo;
    private final long nights;
    private final Money nightlyRate;

    public RoomCharge(Room room, long nights) {
        if (nights < 1) {
            throw new IllegalArgumentException("a stay is at least one billable night, got " + nights);
        }
        this.roomNo = room.roomNo();
        this.nights = nights;
        this.nightlyRate = room.nightlyRate();
    }

    public long nights() {
        return nights;
    }

    public String roomNo() {
        return roomNo;
    }

    @Override
    public String description() {
        return "Room " + roomNo + " — " + nights + (nights == 1 ? " night" : " nights");
    }

    @Override
    public ChargeKind kind() {
        return ChargeKind.ROOM;
    }

    @Override
    public int quantity() {
        return Math.toIntExact(nights);
    }

    @Override
    public Money unitAmount() {
        return nightlyRate;
    }
}
