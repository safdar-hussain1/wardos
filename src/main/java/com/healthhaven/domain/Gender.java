package com.healthhaven.domain;

public enum Gender {
    MALE, FEMALE, OTHER;

    public static Gender of(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("gender is required");
        }
        return switch (raw.trim().toUpperCase()) {
            case "M", "MALE" -> MALE;
            case "F", "FEMALE" -> FEMALE;
            case "O", "OTHER" -> OTHER;
            default -> throw new IllegalArgumentException("unknown gender: " + raw);
        };
    }
}
