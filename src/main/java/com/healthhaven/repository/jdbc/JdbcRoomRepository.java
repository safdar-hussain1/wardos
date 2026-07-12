package com.healthhaven.repository.jdbc;

import com.healthhaven.db.Database;
import com.healthhaven.domain.Money;
import com.healthhaven.domain.Room;
import com.healthhaven.domain.RoomType;
import com.healthhaven.repository.RoomRepository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;

public final class JdbcRoomRepository implements RoomRepository {

    // A room is available when nothing ACTIVE points at it and it is in service.
    private static final String AVAILABLE_WHERE = """
            r.out_of_service = 0
            AND NOT EXISTS (
                SELECT 1 FROM admissions a
                WHERE a.room_no = r.room_no AND a.status = 'ACTIVE'
            )
            """;

    private final Database db;

    public JdbcRoomRepository(Database db) {
        this.db = db;
    }

    @Override
    public void insert(Room room) {
        db.inTransaction(c -> Sql.update(c,
                "INSERT INTO rooms (room_no, room_type, floor, nightly_rate, out_of_service) VALUES (?, ?, ?, ?, ?)",
                ps -> {
                    ps.setString(1, room.roomNo());
                    ps.setString(2, room.type().name());
                    ps.setInt(3, room.floor());
                    ps.setLong(4, room.nightlyRate().paise());
                    ps.setInt(5, room.outOfService() ? 1 : 0);
                }));
    }

    @Override
    public Optional<Room> findByNumber(String roomNo) {
        return db.query(c -> Sql.queryOne(c,
                "SELECT * FROM rooms WHERE room_no = ?",
                ps -> ps.setString(1, roomNo), JdbcRoomRepository::map));
    }

    @Override
    public List<Room> findAll() {
        return db.query(c -> Sql.queryList(c,
                "SELECT * FROM rooms ORDER BY floor, room_no",
                Sql.Binder.NONE, JdbcRoomRepository::map));
    }

    @Override
    public List<Room> findAvailable() {
        return db.query(c -> Sql.queryList(c,
                "SELECT r.* FROM rooms r WHERE " + AVAILABLE_WHERE + " ORDER BY r.nightly_rate, r.room_no",
                Sql.Binder.NONE, JdbcRoomRepository::map));
    }

    @Override
    public List<Room> findAvailable(RoomType type) {
        return db.query(c -> Sql.queryList(c,
                "SELECT r.* FROM rooms r WHERE r.room_type = ? AND " + AVAILABLE_WHERE + " ORDER BY r.room_no",
                ps -> ps.setString(1, type.name()), JdbcRoomRepository::map));
    }

    @Override
    public List<Room> findOccupied() {
        return db.query(c -> Sql.queryList(c,
                """
                SELECT r.* FROM rooms r
                WHERE EXISTS (SELECT 1 FROM admissions a WHERE a.room_no = r.room_no AND a.status = 'ACTIVE')
                ORDER BY r.floor, r.room_no
                """,
                Sql.Binder.NONE, JdbcRoomRepository::map));
    }

    @Override
    public void setOutOfService(String roomNo, boolean outOfService) {
        db.inTransaction(c -> Sql.update(c,
                "UPDATE rooms SET out_of_service = ? WHERE room_no = ?",
                ps -> {
                    ps.setInt(1, outOfService ? 1 : 0);
                    ps.setString(2, roomNo);
                }));
    }

    private static Room map(ResultSet rs) throws SQLException {
        return new Room(
                rs.getString("room_no"),
                RoomType.valueOf(rs.getString("room_type")),
                rs.getInt("floor"),
                Money.ofPaise(rs.getLong("nightly_rate")),
                rs.getInt("out_of_service") == 1);
    }
}
