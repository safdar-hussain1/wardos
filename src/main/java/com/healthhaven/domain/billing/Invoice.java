package com.healthhaven.domain.billing;

import com.healthhaven.domain.Money;
import com.healthhaven.validation.Validate;

import java.time.Instant;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * The bill for one stay.
 *
 * <p>An invoice is built once, from a list of {@link BillableItem}s and a
 * deposit, and every total on it is derived. Nothing here can disagree with
 * anything else here, which is the point. The alternative is recomputing the
 * amount owed inside whichever screen happens to be open, from whatever strings
 * are in its text fields at the time — and then having two screens disagree
 * about what the same patient owes.
 */
public final class Invoice {

    private final long admissionId;
    private final Instant issuedAt;
    private final List<BillableItem> lines;
    private final Money deposit;

    public Invoice(long admissionId, Instant issuedAt, List<BillableItem> lines, Money deposit) {
        this.admissionId = admissionId;
        this.issuedAt = Validate.notNull(issuedAt, "issued at");
        this.lines = List.copyOf(Validate.notEmpty(lines, "invoice lines"));
        this.deposit = Validate.nonNegativeMoney(deposit, "deposit");
        if (this.lines.stream().noneMatch(l -> l.kind() == ChargeKind.ROOM)) {
            throw new IllegalArgumentException("every stay is billed at least one night of room and board");
        }
    }

    public long admissionId() {
        return admissionId;
    }

    public Instant issuedAt() {
        return issuedAt;
    }

    public List<BillableItem> lines() {
        return lines;
    }

    public Money deposit() {
        return deposit;
    }

    /** Nights billed, taken from the room line. */
    public long nights() {
        return lines.stream()
                .filter(RoomCharge.class::isInstance)
                .map(RoomCharge.class::cast)
                .mapToLong(RoomCharge::nights)
                .sum();
    }

    public Money roomTotal() {
        return totalOf(ChargeKind.ROOM);
    }

    public Money extrasTotal() {
        return grossTotal().minus(roomTotal());
    }

    /** Everything the stay cost, before the deposit is applied. */
    public Money grossTotal() {
        return lines.stream().map(BillableItem::lineTotal).reduce(Money.ZERO, Money::plus);
    }

    /**
     * What the patient still owes. Negative means the deposit exceeded the bill
     * and the hospital owes a refund — an outcome this system reports as a
     * refund rather than printing a negative number in a box labelled "amount
     * due" and leaving the desk clerk to work out what it means.
     */
    public Money balanceDue() {
        return grossTotal().minus(deposit);
    }

    public boolean isRefund() {
        return balanceDue().isNegative();
    }

    public Money refundDue() {
        return isRefund() ? Money.ofPaise(-balanceDue().paise()) : Money.ZERO;
    }

    public Money totalOf(ChargeKind kind) {
        return lines.stream()
                .filter(l -> l.kind() == kind)
                .map(BillableItem::lineTotal)
                .reduce(Money.ZERO, Money::plus);
    }

    /** Subtotals per charge kind, for the invoice summary and the revenue mix chart. */
    public Map<ChargeKind, Money> breakdown() {
        Map<ChargeKind, Money> byKind = new EnumMap<>(ChargeKind.class);
        for (BillableItem line : lines) {
            byKind.merge(line.kind(), line.lineTotal(), Money::plus);
        }
        return byKind;
    }

    public String render() {
        StringBuilder out = new StringBuilder();
        out.append("HEALTH HAVEN — INVOICE\n");
        out.append("Admission #").append(admissionId).append("   Issued ").append(issuedAt).append("\n");
        out.append("-".repeat(64)).append('\n');
        for (BillableItem line : lines) {
            out.append(String.format("%-40s %3d x %10s%n",
                    truncate(line.description(), 40), line.quantity(), line.unitAmount().format()));
            out.append(String.format("%56s%n", line.lineTotal().format()));
        }
        out.append("-".repeat(64)).append('\n');
        out.append(String.format("%-45s %18s%n", "Room & board", roomTotal().format()));
        out.append(String.format("%-45s %18s%n", "Extras", extrasTotal().format()));
        out.append(String.format("%-45s %18s%n", "Gross total", grossTotal().format()));
        out.append(String.format("%-45s %18s%n", "Less deposit", deposit.format()));
        out.append("-".repeat(64)).append('\n');
        out.append(String.format("%-45s %18s%n",
                isRefund() ? "REFUND DUE TO PATIENT" : "BALANCE DUE",
                isRefund() ? refundDue().format() : balanceDue().format()));
        return out.toString();
    }

    private static String truncate(String s, int max) {
        return s.length() <= max ? s : s.substring(0, max - 1) + "…";
    }
}
