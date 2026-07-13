package com.healthhaven.service;

import com.healthhaven.domain.Admission;
import com.healthhaven.domain.Room;
import com.healthhaven.domain.billing.BillableItem;
import com.healthhaven.domain.billing.ExtraCharge;
import com.healthhaven.domain.billing.Invoice;
import com.healthhaven.domain.billing.RoomCharge;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Turns a stay into a bill.
 *
 * <p>This is the calculation that is most often got wrong, and the reason this class exists at all.
 * The bill is: (nights × the room's nightly rate) + every recorded extra, minus
 * the deposit. Length of stay is central, not absent; the deposit is subtracted
 * once, at the end, not mistaken for the whole charge.
 */
public final class BillingService {

    /** Builds the invoice for a stay as at {@code asOf}, without persisting it. */
    public Invoice priceStay(Admission admission, Room room, List<ExtraCharge> extras, Instant asOf) {
        long nights = admission.billableNights(asOf);
        List<BillableItem> lines = new ArrayList<>();
        lines.add(new RoomCharge(room, nights));
        lines.addAll(extras);
        Instant issuedAt = admission.dischargedAt().orElse(asOf);
        return new Invoice(admission.id(), issuedAt, lines, admission.deposit());
    }
}
