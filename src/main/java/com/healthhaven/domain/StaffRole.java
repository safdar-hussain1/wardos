package com.healthhaven.domain;

public enum StaffRole {
    DOCTOR, NURSE, TECHNICIAN, DRIVER, ADMIN_STAFF;

    public String label() {
        return switch (this) {
            case DOCTOR -> "Doctor";
            case NURSE -> "Nurse";
            case TECHNICIAN -> "Technician";
            case DRIVER -> "Ambulance driver";
            case ADMIN_STAFF -> "Administration";
        };
    }
}
