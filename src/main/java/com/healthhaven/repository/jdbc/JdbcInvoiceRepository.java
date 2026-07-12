package com.healthhaven.repository.jdbc;

import com.healthhaven.db.Database;
import com.healthhaven.domain.Money;
import com.healthhaven.domain.billing.Invoice;
import com.healthhaven.repository.InvoiceRepository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;

public final class JdbcInvoiceRepository implements InvoiceRepository {

    private final Database db;

    public JdbcInvoiceRepository(Database db) {
        this.db = db;
    }

    @Override
    public long insert(Invoice invoice) {
        return db.inTransaction(c -> insert(c, invoice));
    }

    @Override
    public long insert(java.sql.Connection c, Invoice invoice) {
        return Sql.insert(c,
                """
                INSERT INTO invoices
                    (admission_id, issued_at, nights, room_total, extras_total, gross_total, deposit, balance_due, settled)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
                """,
                ps -> {
                    ps.setLong(1, invoice.admissionId());
                    ps.setString(2, Sql.asText(invoice.issuedAt()));
                    ps.setLong(3, invoice.nights());
                    ps.setLong(4, invoice.roomTotal().paise());
                    ps.setLong(5, invoice.extrasTotal().paise());
                    ps.setLong(6, invoice.grossTotal().paise());
                    ps.setLong(7, invoice.deposit().paise());
                    ps.setLong(8, invoice.balanceDue().paise());
                });
    }

    @Override
    public Optional<StoredInvoice> findByAdmission(long admissionId) {
        return db.query(c -> Sql.queryOne(c,
                "SELECT * FROM invoices WHERE admission_id = ?",
                ps -> ps.setLong(1, admissionId), JdbcInvoiceRepository::map));
    }

    @Override
    public List<StoredInvoice> findAll() {
        return db.query(c -> Sql.queryList(c,
                "SELECT * FROM invoices ORDER BY issued_at DESC",
                Sql.Binder.NONE, JdbcInvoiceRepository::map));
    }

    @Override
    public void markSettled(long invoiceId) {
        db.inTransaction(c -> Sql.update(c,
                "UPDATE invoices SET settled = 1 WHERE id = ?",
                ps -> ps.setLong(1, invoiceId)));
    }

    private static StoredInvoice map(ResultSet rs) throws SQLException {
        return new StoredInvoice(
                rs.getLong("id"),
                rs.getLong("admission_id"),
                Sql.instant(rs, "issued_at"),
                rs.getLong("nights"),
                Money.ofPaise(rs.getLong("room_total")),
                Money.ofPaise(rs.getLong("extras_total")),
                Money.ofPaise(rs.getLong("gross_total")),
                Money.ofPaise(rs.getLong("deposit")),
                Money.ofPaise(rs.getLong("balance_due")),
                rs.getInt("settled") == 1);
    }
}
