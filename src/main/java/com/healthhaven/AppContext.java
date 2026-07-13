package com.healthhaven;

import com.healthhaven.db.Database;
import com.healthhaven.db.DemoData;
import com.healthhaven.db.MutableClock;

import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;

/**
 * Builds a ready-to-use application: an on-disk database at a known path, wired
 * services, and demo data loaded on first run.
 *
 * <p>This is what lets anyone clone the repo and get a populated, working
 * hospital with one command. There is no database server to install, no
 * connection string to configure and no password to leak, because the database
 * is a file this class creates.
 */
public final class AppContext {

    private AppContext() {
    }

    /** The default database location: {@code ./data/health-haven.db}. */
    public static Path defaultDatabasePath() {
        return Path.of("data", "health-haven.db");
    }

    /** Opens (creating and seeding if needed) the on-disk database, returning a running app. */
    public static HealthHaven openOnDisk(Path dbPath) {
        ensureParent(dbPath);
        // A mutable clock lets the seeder lay down dated history; once seeded it
        // reads "now", so the running app behaves as a normal system clock.
        MutableClock clock = new MutableClock(Instant.now());
        Database database = Database.atPath(dbPath);
        HealthHaven app = new HealthHaven(database, clock);
        new DemoData(app, clock).load();
        return app;
    }

    /** A fresh, seeded in-memory app — used by the REST demo server and exports. */
    public static HealthHaven seededInMemory() {
        MutableClock clock = new MutableClock(Instant.now());
        HealthHaven app = new HealthHaven(Database.inMemory(), clock);
        new DemoData(app, clock).load();
        return app;
    }

    /** An empty on-disk app with a real system clock and no demo data. */
    public static HealthHaven emptyOnDisk(Path dbPath) {
        ensureParent(dbPath);
        return new HealthHaven(Database.atPath(dbPath), Clock.systemUTC());
    }

    private static void ensureParent(Path dbPath) {
        try {
            Path parent = dbPath.toAbsolutePath().getParent();
            if (parent != null) {
                java.nio.file.Files.createDirectories(parent);
            }
        } catch (java.io.IOException e) {
            throw new IllegalStateException("could not create database directory for " + dbPath, e);
        }
    }
}
