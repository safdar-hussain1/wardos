package com.healthhaven.repository;

import com.healthhaven.domain.billing.Invoice;

import java.util.List;
import java.util.Optional;

public interface InvoiceRepository {

    /** Stores the computed totals of an invoice. Fails if the stay is already invoiced. */
    long insert(Invoice invoice);

    /** Same, on a caller-supplied connection, so invoicing shares the discharge transaction. */
    long insert(java.sql.Connection connection, Invoice invoice);

    Optional<StoredInvoice> findByAdmission(long admissionId);

    List<StoredInvoice> findAll();

    void markSettled(long invoiceId);

    /**
     * An invoice as it was issued: totals frozen at discharge, not recomputed on
     * read. A bill that changes after the patient has paid it is not a bill.
     */
    record StoredInvoice(long id,
                         long admissionId,
                         java.time.Instant issuedAt,
                         long nights,
                         com.healthhaven.domain.Money roomTotal,
                         com.healthhaven.domain.Money extrasTotal,
                         com.healthhaven.domain.Money grossTotal,
                         com.healthhaven.domain.Money deposit,
                         com.healthhaven.domain.Money balanceDue,
                         boolean settled) {
    }
}
