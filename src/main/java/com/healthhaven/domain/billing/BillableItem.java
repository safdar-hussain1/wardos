package com.healthhaven.domain.billing;

import com.healthhaven.domain.Money;

/**
 * Anything that can appear as a line on an invoice.
 *
 * <p>This is the interface that makes {@link Invoice} indifferent to what it is
 * adding up. A stay's room charge and a stay's MRI scan are computed in
 * completely different ways, but the invoice sums a {@code List<BillableItem>}
 * and never asks which is which.
 */
public interface BillableItem {

    /** What the line says on the printed bill. */
    String description();

    /** Grouping used on the invoice and in the revenue reports. */
    ChargeKind kind();

    int quantity();

    Money unitAmount();

    default Money lineTotal() {
        return unitAmount().times(quantity());
    }
}
