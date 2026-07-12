package com.healthhaven.repository.jdbc;

import com.healthhaven.db.Database;
import com.healthhaven.domain.Role;
import com.healthhaven.domain.User;
import com.healthhaven.repository.UserRepository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

public final class JdbcUserRepository implements UserRepository {

    private final Database db;

    public JdbcUserRepository(Database db) {
        this.db = db;
    }

    @Override
    public User insert(String username, String passwordHash, String fullName, Role role) {
        Instant now = Instant.now();
        long id = db.inTransaction(c -> Sql.insert(c,
                """
                INSERT INTO users (username, password_hash, full_name, role, active, created_at)
                VALUES (?, ?, ?, ?, 1, ?)
                """,
                ps -> {
                    ps.setString(1, username);
                    ps.setString(2, passwordHash);
                    ps.setString(3, fullName);
                    ps.setString(4, role.name());
                    ps.setString(5, Sql.asText(now));
                }));
        return new User(id, username, fullName, role, true, now);
    }

    @Override
    public Optional<User> findByUsername(String username) {
        return db.query(c -> Sql.queryOne(c,
                "SELECT * FROM users WHERE username = ?",
                ps -> ps.setString(1, username), JdbcUserRepository::map));
    }

    @Override
    public Optional<String> findActiveHash(String username) {
        return db.query(c -> Sql.queryOne(c,
                "SELECT password_hash FROM users WHERE username = ? AND active = 1",
                ps -> ps.setString(1, username),
                rs -> rs.getString("password_hash")));
    }

    @Override
    public List<User> findAll() {
        return db.query(c -> Sql.queryList(c,
                "SELECT * FROM users ORDER BY username",
                Sql.Binder.NONE, JdbcUserRepository::map));
    }

    @Override
    public long count() {
        return db.query(c -> Sql.queryLong(c, "SELECT COUNT(*) FROM users", Sql.Binder.NONE));
    }

    private static User map(ResultSet rs) throws SQLException {
        return new User(
                rs.getLong("id"),
                rs.getString("username"),
                rs.getString("full_name"),
                Role.valueOf(rs.getString("role")),
                rs.getInt("active") == 1,
                Sql.instant(rs, "created_at"));
    }
}
