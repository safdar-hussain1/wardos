package com.healthhaven.domain.billing;

import com.healthhaven.domain.Money;
import com.healthhaven.domain.Room;

/**
 * Room and board for a stay: nights × the room's nightly rate.
 *
 * <p>The multiplication is the entire point of this class. The tempting version
 * of a bill is {@code rate − deposit}, which reads perfectly well until you
 * notice that {@code rate} is the price of a <em>single night</em> and the length
 * of the stay is nowhere in it. A three-week ICU stay and one night in the same
 * bed then cost exactly the same, and any deposit larger than one night's rate
 * turns the result negative — a bill claiming the hospital owes the patient
 * money.
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
