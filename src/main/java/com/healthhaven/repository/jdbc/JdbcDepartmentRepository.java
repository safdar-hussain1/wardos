package com.healthhaven.repository.jdbc;

import com.healthhaven.db.Database;
import com.healthhaven.domain.Department;
import com.healthhaven.repository.DepartmentRepository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;

public final class JdbcDepartmentRepository implements DepartmentRepository {

    private final Database db;

    public JdbcDepartmentRepository(Database db) {
        this.db = db;
    }

    @Override
    public Department insert(Department draft) {
        long id = db.inTransaction(c -> Sql.insert(c,
                """
                INSERT INTO departments (name, head, location, specialization, contact_no)
                VALUES (?, ?, ?, ?, ?)
                """,
                ps -> {
                    ps.setString(1, draft.name());
                    ps.setString(2, draft.head());
                    ps.setString(3, draft.location());
                    ps.setString(4, draft.specialization());
                    ps.setString(5, draft.contactNo());
                }));
        return findById(id).orElseThrow();
    }

    @Override
    public Optional<Department> findById(long id) {
        return db.query(c -> Sql.queryOne(c,
                "SELECT * FROM departments WHERE id = ?",
                ps -> ps.setLong(1, id), JdbcDepartmentRepository::map));
    }

    @Override
    public Optional<Department> findByName(String name) {
        return db.query(c -> Sql.queryOne(c,
                "SELECT * FROM departments WHERE name = ?",
                ps -> ps.setString(1, name), JdbcDepartmentRepository::map));
    }

    @Override
    public List<Department> findAll() {
        return db.query(c -> Sql.queryList(c,
                "SELECT * FROM departments ORDER BY name",
                Sql.Binder.NONE, JdbcDepartmentRepository::map));
    }

    private static Department map(ResultSet rs) throws SQLException {
        return new Department(
                rs.getLong("id"),
                rs.getString("name"),
                rs.getString("head"),
                rs.getString("location"),
                rs.getString("specialization"),
                rs.getString("contact_no"));
    }
}
