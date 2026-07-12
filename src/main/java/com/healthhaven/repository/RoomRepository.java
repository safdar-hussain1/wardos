package com.healthhaven.repository;

import com.healthhaven.domain.Room;
import com.healthhaven.domain.RoomType;

import java.util.List;
import java.util.Optional;

public interface RoomRepository {

    void insert(Room room);

    Optional<Room> findByNumber(String roomNo);

    List<Room> findAll();

    /**
     * Rooms with no ACTIVE admission and not out of service.
     *
     * <p>Availability is a query against the admissions table, not a column that
     * somebody remembered to update.
     */
    List<Room> findAvailable();

    List<Room> findAvailable(RoomType type);

    List<Room> findOccupied();

    void setOutOfService(String roomNo, boolean outOfService);
}
