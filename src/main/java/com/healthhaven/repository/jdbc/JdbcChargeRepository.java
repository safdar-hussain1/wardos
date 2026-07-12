package com.healthhaven.repository.jdbc;

import com.healthhaven.db.Database;
import com.healthhaven.domain.Money;
import com.healthhaven.domain.billing.ChargeKind;
import com.healthhaven.domain.billing.ExtraCharge;
import com.healthhaven.repository.ChargeRepository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;

public final class JdbcChargeRepository implements ChargeRepository {

    private final Database db;

    public JdbcChargeRepository(Database db) {
        this.db = db;
    }

    @Override
    public ExtraCharge insert(ExtraCharge draft) {
        long id = db.inTransaction(c -> Sql.insert(c,
                """
                INSERT INTO charges (admission_id, kind, description, quantity, unit_amount, incurred_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                ps -> {
                    ps.setLong(1, draft.admissionId());
                    ps.setString(2, draft.kind().name());
                    ps.setString(3, draft.description());
                    ps.setInt(4, draft.quantity());
                    ps.setLong(5, draft.unitAmount().paise());
                    ps.setString(6, Sql.asText(draft.incurredAt()));
                }));
        return new ExtraCharge(id, draft.admissionId(), draft.kind(), draft.description(),
                draft.quantity(), draft.unitAmount(), draft.incurredAt());
    }

    @Override
    public List<ExtraCharge> findByAdmission(long admissionId) {
        return db.query(c -> Sql.queryList(c,
                "SELECT * FROM charges WHERE admission_id = ? ORDER BY incurred_at",
                ps -> ps.setLong(1, admissionId), JdbcChargeRepository::map));
    }

    @Override
    public List<ExtraCharge> findAll() {
        return db.query(c -> Sql.queryList(c,
                "SELECT * FROM charges ORDER BY incurred_at",
                Sql.Binder.NONE, JdbcChargeRepository::map));
    }

    private static ExtraCharge map(ResultSet rs) throws SQLException {
        return new ExtraCharge(
                rs.getLong("id"),
                rs.getLong("admission_id"),
                ChargeKind.valueOf(rs.getString("kind")),
                rs.getString("description"),
                rs.getInt("quantity"),
                Money.ofPaise(rs.getLong("unit_amount")),
                Sql.instant(rs, "incurred_at"));
    }
}
