package com.healthhaven.db;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;

/**
 * The one place that knows how to open a connection.
 *
 * <p>Three things the original got wrong are fixed here at once.
 *
 * <p>It hardcoded {@code DriverManager.getConnection("jdbc:mysql://localhost/…",
 * "root", "<the developer's own MySQL root password>")} — committed to source, in
 * plain sight. The location of the database is configuration here, and there is no
 * password to leak at all, because the database is a file.
 *
 * <p>It constructed a {@code new Connect()} inside every button handler and
 * never closed any of them, so a long session leaked one MySQL connection per
 * click until the server refused more. Connections here are opened per unit of
 * work and closed by try-with-resources, always.
 *
 * <p>It required a running MySQL server with a schema you had to build by hand
 * from screenshots, which is why the project could not be run by anyone who was
 * not the author. This one creates its own schema on first open.
 */
public final class Database implements AutoCloseable {

    private final String url;

    /**
     * For a shared-cache in-memory database, one connection held open for the
     * lifetime of this object. SQLite discards an in-memory database the instant
     * its last connection closes, so without this the schema would vanish between
     * the migration and the first real query. Null for on-disk databases.
     */
    private final Connection keepAlive;

    private Database(String url, boolean inMemory) {
        this.url = url;
        this.keepAlive = inMemory ? openRaw() : null;
        migrate();
    }

    /** Opens (creating if absent) a database file on disk. */
    public static Database atPath(Path file) {
        return new Database("jdbc:sqlite:" + file.toAbsolutePath(), false);
    }

    /**
     * A private in-memory database, used by the tests and the audit harness.
     * Each call gets its own, discarded when this object is closed.
     */
    public static Database inMemory() {
        return new Database("jdbc:sqlite:file:hh-" + System.nanoTime()
                + "?mode=memory&cache=shared", true);
    }

    /**
     * Opens a connection with foreign keys on.
     *
     * <p>SQLite defaults {@code foreign_keys} to OFF for backwards compatibility,
     * per connection, so every connection has to say so explicitly. Miss this and
     * the REFERENCES clauses in the schema are decoration.
     */
    public Connection open() {
        return openRaw();
    }

    private Connection openRaw() {
        try {
            Connection connection = DriverManager.getConnection(url);
            try (Statement s = connection.createStatement()) {
                s.execute("PRAGMA foreign_keys = ON");
                s.execute("PRAGMA busy_timeout = 5000");
            }
            return connection;
        } catch (SQLException e) {
            throw new DataAccessException("could not open the database at " + url, e);
        }
    }

    /**
     * Runs {@code work} inside a transaction, committing on success and rolling
     * back on any exception.
     *
     * <p>This is the mechanism that stops the original's admit-a-patient bug.
     * {@code AddNewPatient.addPatient()} ran two statements — insert the patient,
     * then mark the room occupied — as two separate auto-committed round trips.
     * If the second failed, the patient was in a bed the system believed was
     * empty. Both statements are one transaction here, or neither happens.
     */
    public <T> T inTransaction(TransactionalWork<T> work) {
        try (Connection connection = open()) {
            connection.setAutoCommit(false);
            try {
                T result = work.execute(connection);
                connection.commit();
                return result;
            } catch (Exception e) {
                connection.rollback();
                throw e instanceof RuntimeException re ? re : new DataAccessException("transaction failed", e);
            }
        } catch (SQLException e) {
            throw new DataAccessException("transaction failed", e);
        }
    }

    /** Read-only work that still needs a connection, without the transaction ceremony. */
    public <T> T query(TransactionalWork<T> work) {
        try (Connection connection = open()) {
            return work.execute(connection);
        } catch (SQLException e) {
            throw new DataAccessException("query failed", e);
        } catch (Exception e) {
            throw e instanceof RuntimeException re ? re : new DataAccessException("query failed", e);
        }
    }

    private void migrate() {
        String schema = readResource("/db/schema.sql");
        // Strip line comments before splitting: the header comments contain
        // semicolons, and splitting on ';' first would break statements apart.
        String stripped = schema.replaceAll("(?m)--.*$", "");
        try (Connection connection = open(); Statement statement = connection.createStatement()) {
            for (String fragment : stripped.split(";")) {
                String ddl = fragment.trim();
                if (!ddl.isEmpty()) {
                    statement.execute(ddl);
                }
            }
        } catch (SQLException e) {
            throw new DataAccessException("schema migration failed", e);
        }
    }

    private static String readResource(String name) {
        try (InputStream in = Database.class.getResourceAsStream(name)) {
            if (in == null) {
                throw new DataAccessException("missing resource on the classpath: " + name, null);
            }
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new DataAccessException("could not read " + name, e);
        }
    }

    public String url() {
        return url;
    }

    @Override
    public void close() {
        // On-disk databases hold nothing; an in-memory one is kept alive by a
        // single connection that must be released here to free it.
        if (keepAlive != null) {
            try {
                keepAlive.close();
            } catch (SQLException e) {
                throw new DataAccessException("could not close the in-memory database", e);
            }
        }
    }

    @FunctionalInterface
    public interface TransactionalWork<T> {
        T execute(Connection connection) throws Exception;
    }
}
