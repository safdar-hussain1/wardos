package com.healthhaven.domain;

import com.healthhaven.validation.Validate;

import java.time.Instant;

/**
 * A login account.
 *
 * <p>The password hash never leaves the persistence layer as anything but a
 * hash, and this class exposes no getter for it at all: nothing above the
 * repository can read it, log it, or accidentally drop it into a table model.
 * You cannot leak what you cannot reach.
 */
public final class User {

    private final long id;
    private final String username;
    private final String fullName;
    private final Role role;
    private final boolean active;
    private final Instant createdAt;

    public User(long id, String username, String fullName, Role role, boolean active, Instant createdAt) {
        this.id = id;
        this.username = Validate.username(username);
        this.fullName = Validate.name(fullName, "full name");
        this.role = Validate.notNull(role, "role");
        this.active = active;
        this.createdAt = Validate.notNull(createdAt, "created at");
    }

    public long id() {
        return id;
    }

    public String username() {
        return username;
    }

    public String fullName() {
        return fullName;
    }

    public Role role() {
        return role;
    }

    public boolean isActive() {
        return active;
    }

    public Instant createdAt() {
        return createdAt;
    }

    public boolean can(Permission permission) {
        return active && role.can(permission);
    }
}
