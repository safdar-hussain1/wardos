package com.healthhaven.domain.billing;

import com.healthhaven.domain.Money;
import com.healthhaven.validation.Validate;

import java.time.Instant;

/** A discrete chargeable event recorded against a stay: a scan, a consult, a drug, a ride. */
public final class ExtraCharge implements BillableItem {

    private final long id;
    private final long admissionId;
    private final ChargeKind kind;
    private final String description;
    private final int quantity;
    private final Money unitAmount;
    private final Instant incurredAt;

    public ExtraCharge(long id,
                       long admissionId,
                       ChargeKind kind,
                       String description,
                       int quantity,
                       Money unitAmount,
                       Instant incurredAt) {
        this.id = id;
        this.admissionId = admissionId;
        this.kind = Validate.notNull(kind, "charge kind");
        if (!kind.isRecordable()) {
            throw new IllegalArgumentException("room charges are derived from the stay, not recorded");
        }
        this.description = Validate.notBlank(description, "charge description");
        this.quantity = Validate.range(quantity, 1, 1_000, "quantity");
        this.unitAmount = Validate.nonNegativeMoney(unitAmount, "unit amount");
        this.incurredAt = Validate.notNull(incurredAt, "incurred at");
    }

    public long id() {
        return id;
    }

    public long admissionId() {
        return admissionId;
    }

    public Instant incurredAt() {
        return incurredAt;
    }

    @Override
    public String description() {
        return description;
    }

    @Override
    public ChargeKind kind() {
        return kind;
    }

    @Override
    public int quantity() {
        return quantity;
    }

    @Override
    public Money unitAmount() {
        return unitAmount;
    }
}
