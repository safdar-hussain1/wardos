package com.healthhaven.domain;

import java.util.Set;

/**
 * Login roles and what each may do.
 *
 * <p>A system with a {@code login} table and no concept of a role gives everyone
 * who gets past the password screen the power to do everything, including
 * destroy records. Permissions are explicit here and checked in the service
 * layer rather than the UI, so bypassing a disabled button gains nothing.
 */
public enum Role {
    ADMIN(Set.of(Permission.values())),

    DOCTOR(Set.of(
            Permission.VIEW_PATIENTS,
            Permission.VIEW_ADMISSIONS,
            Permission.RECORD_CHARGE,
            Permission.VIEW_STAFF,
            Permission.VIEW_REPORTS)),

    RECEPTIONIST(Set.of(
            Permission.VIEW_PATIENTS,
            Permission.REGISTER_PATIENT,
            Permission.VIEW_ADMISSIONS,
            Permission.ADMIT_PATIENT,
            Permission.DISCHARGE_PATIENT,
            Permission.RECORD_CHARGE,
            Permission.VIEW_ROOMS,
            Permission.VIEW_STAFF,
            Permission.DISPATCH_AMBULANCE));

    private final Set<Permission> permissions;

    Role(Set<Permission> permissions) {
        this.permissions = permissions;
    }

    public boolean can(Permission permission) {
        return permissions.contains(permission);
    }

    public Set<Permission> permissions() {
        return permissions;
    }
}
