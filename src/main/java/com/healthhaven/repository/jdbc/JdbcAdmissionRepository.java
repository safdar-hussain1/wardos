package com.healthhaven.repository.jdbc;

import com.healthhaven.db.Database;
import com.healthhaven.domain.Admission;
import com.healthhaven.domain.Money;
import com.healthhaven.repository.AdmissionRepository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

public final class JdbcAdmissionRepository implements AdmissionRepository {

    private final Database db;

    public JdbcAdmissionRepository(Database db) {
        this.db = db;
    }

    @Override
    public Admission insert(Admission draft) {
        long id = db.inTransaction(c -> insert(c, draft));
        return findById(id).orElseThrow();
    }

    /** Package-visible insert on a caller's connection, so admission and audit share one transaction. */
    long insert(java.sql.Connection c, Admission draft) {
        return Sql.insert(c,
                """
                INSERT INTO admissions
                    (patient_id, room_no, department_id, diagnosis, admitted_at, discharged_at, deposit, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                ps -> {
                    ps.setLong(1, draft.patientId());
                    ps.setString(2, draft.roomNo());
                    ps.setLong(3, draft.departmentId());
                    ps.setString(4, draft.diagnosis());
                    ps.setString(5, Sql.asText(draft.admittedAt()));
                    ps.setString(6, Sql.asText(draft.dischargedAt().orElse(null)));
                    ps.setLong(7, draft.deposit().paise());
                    ps.setString(8, draft.status().name());
                });
    }

    @Override
    public Optional<Admission> findById(long id) {
        return db.query(c -> Sql.queryOne(c,
                "SELECT * FROM admissions WHERE id = ?",
                ps -> ps.setLong(1, id), JdbcAdmissionRepository::map));
    }

    @Override
    public Optional<Admission> findActiveByRoom(String roomNo) {
        return db.query(c -> Sql.queryOne(c,
                "SELECT * FROM admissions WHERE room_no = ? AND status = 'ACTIVE'",
                ps -> ps.setString(1, roomNo), JdbcAdmissionRepository::map));
    }

    @Override
    public Optional<Admission> findActiveByPatient(long patientId) {
        return db.query(c -> Sql.queryOne(c,
                "SELECT * FROM admissions WHERE patient_id = ? AND status = 'ACTIVE'",
                ps -> ps.setLong(1, patientId), JdbcAdmissionRepository::map));
    }

    @Override
    public List<Admission> findActive() {
        return db.query(c -> Sql.queryList(c,
                "SELECT * FROM admissions WHERE status = 'ACTIVE' ORDER BY admitted_at",
                Sql.Binder.NONE, JdbcAdmissionRepository::map));
    }

    @Override
    public List<Admission> findByPatient(long patientId) {
        return db.query(c -> Sql.queryList(c,
                "SELECT * FROM admissions WHERE patient_id = ? ORDER BY admitted_at DESC",
                ps -> ps.setLong(1, patientId), JdbcAdmissionRepository::map));
    }

    @Override
    public List<Admission> findAll() {
        return db.query(c -> Sql.queryList(c,
                "SELECT * FROM admissions ORDER BY admitted_at DESC",
                Sql.Binder.NONE, JdbcAdmissionRepository::map));
    }

    @Override
    public List<Admission> findAdmittedBetween(Instant from, Instant to) {
        return db.query(c -> Sql.queryList(c,
                "SELECT * FROM admissions WHERE admitted_at >= ? AND admitted_at < ? ORDER BY admitted_at",
                ps -> {
                    ps.setString(1, Sql.asText(from));
                    ps.setString(2, Sql.asText(to));
                }, JdbcAdmissionRepository::map));
    }

    @Override
    public void markDischarged(long admissionId, Instant dischargedAt) {
        db.inTransaction(c -> {
            markDischarged(c, admissionId, dischargedAt);
            return null;
        });
    }

    @Override
    public void markDischarged(java.sql.Connection c, long admissionId, Instant dischargedAt) {
        int rows = Sql.update(c,
                "UPDATE admissions SET status = 'DISCHARGED', discharged_at = ? WHERE id = ? AND status = 'ACTIVE'",
                ps -> {
                    ps.setString(1, Sql.asText(dischargedAt));
                    ps.setLong(2, admissionId);
                });
        if (rows == 0) {
            throw new com.healthhaven.db.DataAccessException(
                    "admission " + admissionId + " is not active; nothing to discharge");
        }
    }

    private static Admission map(ResultSet rs) throws SQLException {
        return new Admission(
                rs.getLong("id"),
                rs.getLong("patient_id"),
                rs.getString("room_no"),
                rs.getLong("department_id"),
                rs.getString("diagnosis"),
                Sql.instant(rs, "admitted_at"),
                Sql.instant(rs, "discharged_at"),
                Money.ofPaise(rs.getLong("deposit")));
    }
}
