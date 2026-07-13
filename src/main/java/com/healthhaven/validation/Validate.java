package com.healthhaven.validation;

import com.healthhaven.domain.Money;

import java.time.LocalDate;
import java.util.Collection;
import java.util.regex.Pattern;

/**
 * Fail-fast checks used by every constructor in the domain.
 *
 * <p>Without these, a blank name, a deposit of "abc" and a room number that does
 * not exist all go straight into an {@code INSERT}, and the first sign of trouble
 * is a {@code NumberFormatException} on a console nobody is watching. Objects
 * here cannot be constructed in an invalid state, so nothing downstream has to
 * wonder whether they are.
 */
public final class Validate {

    private static final Pattern PHONE = Pattern.compile("\\+?[0-9][0-9 \\-]{7,14}[0-9]");
    private static final Pattern EMAIL = Pattern.compile("[^@\\s]+@[^@\\s.]+\\.[^@\\s]{2,}");
    private static final Pattern USERNAME = Pattern.compile("[a-z0-9._-]{3,32}");
    private static final Pattern ROOM_NO = Pattern.compile("[A-Z]{1,3}-[0-9]{2,4}");
    private static final Pattern NAME = Pattern.compile("[\\p{L}][\\p{L} .'\\-]{1,79}");

    private Validate() {
    }

    public static <T> T notNull(T value, String field) {
        if (value == null) {
            throw new ValidationException(field + " is required");
        }
        return value;
    }

    public static String notBlank(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new ValidationException(field + " is required");
        }
        return value.trim();
    }

    public static <T> Collection<T> notEmpty(Collection<T> value, String field) {
        if (value == null || value.isEmpty()) {
            throw new ValidationException(field + " must not be empty");
        }
        return value;
    }

    public static String name(String value, String field) {
        String trimmed = notBlank(value, field);
        if (!NAME.matcher(trimmed).matches()) {
            throw new ValidationException(field + " is not a plausible name: \"" + value + "\"");
        }
        return trimmed;
    }

    public static String phone(String value) {
        String trimmed = notBlank(value, "phone number");
        if (!PHONE.matcher(trimmed).matches()) {
            throw new ValidationException("not a valid phone number: \"" + value + "\"");
        }
        return trimmed;
    }

    public static String email(String value) {
        String trimmed = notBlank(value, "email");
        if (!EMAIL.matcher(trimmed).matches()) {
            throw new ValidationException("not a valid email address: \"" + value + "\"");
        }
        return trimmed;
    }

    public static String username(String value) {
        String trimmed = notBlank(value, "username").toLowerCase();
        if (!USERNAME.matcher(trimmed).matches()) {
            throw new ValidationException("username must be 3-32 characters of a-z, 0-9, dot, dash or underscore");
        }
        return trimmed;
    }

    public static String roomNumber(String value) {
        String trimmed = notBlank(value, "room number").toUpperCase();
        if (!ROOM_NO.matcher(trimmed).matches()) {
            throw new ValidationException("room number must look like ICU-101 or G-204, got \"" + value + "\"");
        }
        return trimmed;
    }

    public static String digits(String value, int length, String field) {
        String trimmed = notBlank(value, field);
        if (trimmed.length() != length || !trimmed.chars().allMatch(Character::isDigit)) {
            throw new ValidationException(field + " must be exactly " + length + " digits");
        }
        return trimmed;
    }

    public static int range(int value, int min, int max, String field) {
        if (value < min || value > max) {
            throw new ValidationException(field + " must be between " + min + " and " + max + ", got " + value);
        }
        return value;
    }

    public static Money positiveMoney(Money value, String field) {
        notNull(value, field);
        if (value.paise() <= 0) {
            throw new ValidationException(field + " must be greater than zero, got " + value.format());
        }
        return value;
    }

    public static Money nonNegativeMoney(Money value, String field) {
        notNull(value, field);
        if (value.isNegative()) {
            throw new ValidationException(field + " must not be negative, got " + value.format());
        }
        return value;
    }

    public static LocalDate pastDate(LocalDate value, String field) {
        notNull(value, field);
        if (value.isAfter(LocalDate.now())) {
            throw new ValidationException(field + " is in the future: " + value);
        }
        return value;
    }
}
