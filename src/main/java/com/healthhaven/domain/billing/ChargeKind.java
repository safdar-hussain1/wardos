package com.healthhaven.domain.billing;

public enum ChargeKind {
    ROOM("Room & board"),
    PROCEDURE("Procedures"),
    CONSULTATION("Consultations"),
    PHARMACY("Pharmacy"),
    AMBULANCE("Ambulance");

    private final String label;

    ChargeKind(String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }

    /** The kinds that can be recorded against a stay. ROOM is derived, never recorded. */
    public boolean isRecordable() {
        return this != ROOM;
    }
}
