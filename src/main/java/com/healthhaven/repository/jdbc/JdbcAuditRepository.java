package com.healthhaven.repository.jdbc;

import com.healthhaven.db.Database;
import com.healthhaven.repository.AuditRepository;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;

public final class JdbcAuditRepository implements AuditRepository {

    private final Database db;

    public JdbcAuditRepository(Database db) {
        this.db = db;
    }

    @Override
    public void record(Connection connection, String actor, String action, String entity,
                       String entityId, String detail) {
        Sql.insert(connection,
                "INSERT INTO audit_log (at, actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?)",
                ps -> {
                    ps.setString(1, Sql.asText(Instant.now()));
                    ps.setString(2, actor);
                    ps.setString(3, action);
                    ps.setString(4, entity);
                    ps.setString(5, entityId);
                    ps.setString(6, detail);
                });
    }

    @Override
    public List<Entry> recent(int limit) {
        return db.query(c -> Sql.queryList(c,
                "SELECT * FROM audit_log ORDER BY at DESC, id DESC LIMIT ?",
                ps -> ps.setInt(1, limit), JdbcAuditRepository::map));
    }

    private static Entry map(ResultSet rs) throws SQLException {
        return new Entry(
                Sql.instant(rs, "at"),
                rs.getString("actor"),
                rs.getString("action"),
                rs.getString("entity"),
                rs.getString("entity_id"),
                rs.getString("detail"));
    }
}
