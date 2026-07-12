package com.healthhaven.repository;

import java.sql.Connection;
import java.util.List;

public interface AuditRepository {

    /**
     * Appends one entry. Takes the connection so an audit row is written inside
     * the same transaction as the change it records — if the change rolls back,
     * so does its audit line.
     */
    void record(Connection connection, String actor, String action, String entity, String entityId, String detail);

    List<Entry> recent(int limit);

    record Entry(java.time.Instant at, String actor, String action, String entity, String entityId, String detail) {
    }
}
