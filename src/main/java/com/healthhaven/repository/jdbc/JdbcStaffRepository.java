package com.healthhaven.repository.jdbc;

import com.healthhaven.db.Database;
import com.healthhaven.domain.AdminStaff;
import com.healthhaven.domain.Doctor;
import com.healthhaven.domain.Driver;
import com.healthhaven.domain.Gender;
import com.healthhaven.domain.Money;
import com.healthhaven.domain.Nurse;
import com.healthhaven.domain.StaffMember;
import com.healthhaven.domain.StaffRole;
import com.healthhaven.domain.Technician;
import com.healthhaven.repository.StaffRepository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;

/**
 * Reconstructs the right {@link StaffMember} subclass from a row.
 *
 * <p>The {@code staff.role} column drives a switch that builds a {@link Doctor},
 * {@link Nurse}, and so on. This is the single-table-inheritance mapping: one
 * table, a discriminator column, and role-specific fields ({@code specialty},
 * {@code ward}, {@code licence_no}) that are null for the roles that do not use
 * them. Callers get back polymorphic objects and never touch the discriminator.
 */
public final class JdbcStaffRepository implements StaffRepository {

    private final Database db;

    public JdbcStaffRepository(Database db) {
        this.db = db;
    }

    @Override
    public StaffMember insert(StaffMember draft) {
        long id = db.inTransaction(c -> Sql.insert(c,
                """
                INSERT INTO staff
                    (staff_code, full_name, gender, phone, email, role, department_id, base_salary,
                     specialty, ward, licence_no, joined_on)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                ps -> {
                    ps.setString(1, draft.staffCode());
                    ps.setString(2, draft.fullName());
                    ps.setString(3, draft.gender().name());
                    ps.setString(4, draft.phone());
                    ps.setString(5, draft.email());
                    ps.setString(6, draft.role().name());
                    if (draft.departmentId().isPresent()) {
                        ps.setLong(7, draft.departmentId().get());
                    } else {
                        ps.setNull(7, java.sql.Types.INTEGER);
                    }
                    ps.setLong(8, draft.baseSalary().paise());
                    ps.setString(9, draft instanceof Doctor d ? d.specialty() : null);
                    ps.setString(10, draft instanceof Nurse n ? n.ward() : null);
                    ps.setString(11, draft instanceof Driver dr ? dr.licenceNo() : null);
                    ps.setString(12, Sql.asText(draft.joinedOn()));
                }));
        return findByIdInternal(id).orElseThrow();
    }

    @Override
    public Optional<StaffMember> findByCode(String staffCode) {
        return db.query(c -> Sql.queryOne(c,
                "SELECT * FROM staff WHERE staff_code = ?",
                ps -> ps.setString(1, staffCode), JdbcStaffRepository::map));
    }

    private Optional<StaffMember> findByIdInternal(long id) {
        return db.query(c -> Sql.queryOne(c,
                "SELECT * FROM staff WHERE id = ?",
                ps -> ps.setLong(1, id), JdbcStaffRepository::map));
    }

    @Override
    public List<StaffMember> findAll() {
        return db.query(c -> Sql.queryList(c,
                "SELECT * FROM staff ORDER BY role, full_name",
                Sql.Binder.NONE, JdbcStaffRepository::map));
    }

    @Override
    public List<StaffMember> findByDepartment(long departmentId) {
        return db.query(c -> Sql.queryList(c,
                "SELECT * FROM staff WHERE department_id = ? ORDER BY role, full_name",
                ps -> ps.setLong(1, departmentId), JdbcStaffRepository::map));
    }

    @Override
    public long countDoctorsInDepartment(long departmentId) {
        return db.query(c -> Sql.queryLong(c,
                "SELECT COUNT(*) FROM staff WHERE department_id = ? AND role = 'DOCTOR'",
                ps -> ps.setLong(1, departmentId)));
    }

    private static StaffMember map(ResultSet rs) throws SQLException {
        StaffMember.Profile profile = new StaffMember.Profile(
                rs.getLong("id"),
                rs.getString("staff_code"),
                rs.getString("full_name"),
                Gender.valueOf(rs.getString("gender")),
                rs.getString("phone"),
                rs.getString("email"),
                Sql.nullableLong(rs, "department_id"),
                Money.ofPaise(rs.getLong("base_salary")),
                Sql.date(rs, "joined_on"));
        return switch (StaffRole.valueOf(rs.getString("role"))) {
            case DOCTOR -> new Doctor(profile, rs.getString("specialty"));
            case NURSE -> new Nurse(profile, rs.getString("ward"));
            case TECHNICIAN -> new Technician(profile);
            case DRIVER -> new Driver(profile, rs.getString("licence_no"));
            case ADMIN_STAFF -> new AdminStaff(profile);
        };
    }
}
