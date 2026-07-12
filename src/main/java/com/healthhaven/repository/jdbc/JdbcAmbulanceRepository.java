package com.healthhaven.repository.jdbc;

import com.healthhaven.db.Database;
import com.healthhaven.domain.Ambulance;
import com.healthhaven.repository.AmbulanceRepository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

public final class JdbcAmbulanceRepository implements AmbulanceRepository {

    private final Database db;

    public JdbcAmbulanceRepository(Database db) {
        this.db = db;
    }

    @Override
    public Ambulance insert(Ambulance draft) {
        long id = db.inTransaction(c -> Sql.insert(c,
                """
                INSERT INTO ambulances (vehicle_no, driver_name, driver_phone, status, base_location)
                VALUES (?, ?, ?, ?, ?)
                """,
                ps -> {
                    ps.setString(1, draft.vehicleNo());
                    ps.setString(2, draft.driverName());
                    ps.setString(3, draft.driverPhone());
                    ps.setString(4, draft.status().name());
                    ps.setString(5, draft.baseLocation());
                }));
        return findById(id).orElseThrow();
    }

    @Override
    public Optional<Ambulance> findById(long id) {
        return db.query(c -> Sql.queryOne(c,
                "SELECT * FROM ambulances WHERE id = ?",
                ps -> ps.setLong(1, id), JdbcAmbulanceRepository::map));
    }

    @Override
    public List<Ambulance> findAll() {
        return db.query(c -> Sql.queryList(c,
                "SELECT * FROM ambulances ORDER BY vehicle_no",
                Sql.Binder.NONE, JdbcAmbulanceRepository::map));
    }

    @Override
    public List<Ambulance> findAvailable() {
        return db.query(c -> Sql.queryList(c,
                "SELECT * FROM ambulances WHERE status = 'AVAILABLE' ORDER BY vehicle_no",
                Sql.Binder.NONE, JdbcAmbulanceRepository::map));
    }

    @Override
    public void updateStatus(long ambulanceId, Ambulance.Status status) {
        db.inTransaction(c -> Sql.update(c,
                "UPDATE ambulances SET status = ? WHERE id = ?",
                ps -> {
                    ps.setString(1, status.name());
                    ps.setLong(2, ambulanceId);
                }));
    }

    @Override
    public long openDispatch(long ambulanceId, String destination, Instant at) {
        return db.inTransaction(c -> {
            long id = Sql.insert(c,
                    "INSERT INTO dispatches (ambulance_id, destination, dispatched_at) VALUES (?, ?, ?)",
                    ps -> {
                        ps.setLong(1, ambulanceId);
                        ps.setString(2, destination);
                        ps.setString(3, Sql.asText(at));
                    });
            Sql.update(c, "UPDATE ambulances SET status = 'DISPATCHED' WHERE id = ?",
                    ps -> ps.setLong(1, ambulanceId));
            return id;
        });
    }

    @Override
    public void closeDispatch(long ambulanceId, Instant returnedAt) {
        db.inTransaction(c -> {
            Sql.update(c,
                    "UPDATE dispatches SET returned_at = ? WHERE ambulance_id = ? AND returned_at IS NULL",
                    ps -> {
                        ps.setString(1, Sql.asText(returnedAt));
                        ps.setLong(2, ambulanceId);
                    });
            Sql.update(c, "UPDATE ambulances SET status = 'AVAILABLE' WHERE id = ?",
                    ps -> ps.setLong(1, ambulanceId));
            return null;
        });
    }

    private static Ambulance map(ResultSet rs) throws SQLException {
        return new Ambulance(
                rs.getLong("id"),
                rs.getString("vehicle_no"),
                rs.getString("driver_name"),
                rs.getString("driver_phone"),
                Ambulance.Status.valueOf(rs.getString("status")),
                rs.getString("base_location"));
    }
}
