package com.healthhaven.repository.jdbc;

import com.healthhaven.db.Database;
import com.healthhaven.domain.Gender;
import com.healthhaven.domain.Patient;
import com.healthhaven.repository.PatientRepository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;

public final class JdbcPatientRepository implements PatientRepository {

    private final Database db;

    public JdbcPatientRepository(Database db) {
        this.db = db;
    }

    @Override
    public Patient insert(Patient draft) {
        long id = db.inTransaction(c -> Sql.insert(c,
                """
                INSERT INTO patients (mrn, full_name, gender, date_of_birth, phone, id_kind, id_last4, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                ps -> {
                    ps.setString(1, draft.mrn());
                    ps.setString(2, draft.fullName());
                    ps.setString(3, draft.gender().name());
                    ps.setString(4, Sql.asText(draft.dateOfBirth()));
                    ps.setString(5, draft.phone());
                    ps.setString(6, draft.idKind().name());
                    ps.setString(7, draft.idLast4());
                    ps.setString(8, Sql.asText(draft.registeredAt()));
                }));
        return findById(id).orElseThrow();
    }

    @Override
    public Optional<Patient> findById(long id) {
        return db.query(c -> Sql.queryOne(c,
                "SELECT * FROM patients WHERE id = ?",
                ps -> ps.setLong(1, id), JdbcPatientRepository::map));
    }

    @Override
    public Optional<Patient> findByMrn(String mrn) {
        return db.query(c -> Sql.queryOne(c,
                "SELECT * FROM patients WHERE mrn = ?",
                ps -> ps.setString(1, mrn), JdbcPatientRepository::map));
    }

    @Override
    public List<Patient> findAll() {
        return db.query(c -> Sql.queryList(c,
                "SELECT * FROM patients ORDER BY registered_at DESC",
                Sql.Binder.NONE, JdbcPatientRepository::map));
    }

    @Override
    public List<Patient> search(String term) {
        String like = "%" + term.toLowerCase() + "%";
        return db.query(c -> Sql.queryList(c,
                "SELECT * FROM patients WHERE lower(full_name) LIKE ? OR lower(mrn) LIKE ? ORDER BY full_name",
                ps -> {
                    ps.setString(1, like);
                    ps.setString(2, like);
                }, JdbcPatientRepository::map));
    }

    @Override
    public long count() {
        return db.query(c -> Sql.queryLong(c, "SELECT COUNT(*) FROM patients", Sql.Binder.NONE));
    }

    @Override
    public String nextMrn() {
        long next = db.query(c -> Sql.queryLong(c,
                // MRNs look like HH-000042; take the numeric suffix of the current max.
                "SELECT COALESCE(MAX(CAST(substr(mrn, 4) AS INTEGER)), 0) FROM patients WHERE mrn LIKE 'HH-%'",
                Sql.Binder.NONE)) + 1;
        return String.format("HH-%06d", next);
    }

    private static Patient map(ResultSet rs) throws SQLException {
        return new Patient(
                rs.getLong("id"),
                rs.getString("mrn"),
                rs.getString("full_name"),
                Gender.valueOf(rs.getString("gender")),
                Sql.date(rs, "date_of_birth"),
                rs.getString("phone"),
                Patient.IdKind.valueOf(rs.getString("id_kind")),
                rs.getString("id_last4"),
                Sql.instant(rs, "registered_at"));
    }
}
