package com.healthhaven.repository.jdbc;

import com.healthhaven.db.DataAccessException;
import com.healthhaven.domain.Money;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Small helpers shared by the JDBC repositories.
 *
 * <p>Every query in this package goes through {@link PreparedStatement}. There
 * is no method here that takes a SQL fragment and a value and concatenates them,
 * because the moment such a method exists somebody will use it. The original
 * built every one of its 30-odd queries by string concatenation, including the
 * login check.
 */
final class Sql {

    private Sql() {
    }

    interface RowMapper<T> {
        T map(ResultSet rs) throws SQLException;
    }

    static <T> List<T> queryList(Connection c, String sql, Binder binder, RowMapper<T> mapper) {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            binder.bind(ps);
            try (ResultSet rs = ps.executeQuery()) {
                List<T> out = new ArrayList<>();
                while (rs.next()) {
                    out.add(mapper.map(rs));
                }
                return out;
            }
        } catch (SQLException e) {
            throw new DataAccessException("query failed: " + sql, e);
        }
    }

    static <T> Optional<T> queryOne(Connection c, String sql, Binder binder, RowMapper<T> mapper) {
        List<T> rows = queryList(c, sql, binder, mapper);
        if (rows.size() > 1) {
            throw new DataAccessException("expected at most one row, got " + rows.size() + " from: " + sql);
        }
        return rows.stream().findFirst();
    }

    static long queryLong(Connection c, String sql, Binder binder) {
        return queryOne(c, sql, binder, rs -> rs.getLong(1)).orElse(0L);
    }

    static int update(Connection c, String sql, Binder binder) {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            binder.bind(ps);
            return ps.executeUpdate();
        } catch (SQLException e) {
            throw new DataAccessException("update failed: " + sql, e);
        }
    }

    /** Inserts and returns the generated primary key. */
    static long insert(Connection c, String sql, Binder binder) {
        try (PreparedStatement ps = c.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            binder.bind(ps);
            ps.executeUpdate();
            try (ResultSet keys = ps.getGeneratedKeys()) {
                if (!keys.next()) {
                    throw new DataAccessException("insert returned no generated key: " + sql);
                }
                return keys.getLong(1);
            }
        } catch (SQLException e) {
            throw new DataAccessException("insert failed: " + sql, e);
        }
    }

    @FunctionalInterface
    interface Binder {
        void bind(PreparedStatement ps) throws SQLException;

        Binder NONE = ps -> {
        };
    }

    // -- type conversions -------------------------------------------------
    // SQLite has no native timestamp or decimal type. Instants are stored as
    // ISO-8601 UTC strings (which sort correctly as text) and money as integer
    // paise. Both conversions live here so that no repository invents its own.

    static String asText(Instant instant) {
        return instant == null ? null : instant.toString();
    }

    static Instant instant(ResultSet rs, String column) throws SQLException {
        String text = rs.getString(column);
        return text == null ? null : Instant.parse(text);
    }

    static String asText(LocalDate date) {
        return date == null ? null : date.toString();
    }

    static LocalDate date(ResultSet rs, String column) throws SQLException {
        String text = rs.getString(column);
        return text == null ? null : LocalDate.parse(text);
    }

    static Money money(ResultSet rs, String column) throws SQLException {
        return Money.ofPaise(rs.getLong(column));
    }

    static Long nullableLong(ResultSet rs, String column) throws SQLException {
        long value = rs.getLong(column);
        return rs.wasNull() ? null : value;
    }
}
