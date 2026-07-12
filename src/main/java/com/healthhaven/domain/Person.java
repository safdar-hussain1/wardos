package com.healthhaven.domain;

import com.healthhaven.validation.Validate;

import java.time.LocalDate;
import java.time.Period;

/**
 * Everything the hospital knows about a human being, patient or staff.
 *
 * <p>Sealed so that the set of people the system recognises is closed and can be
 * switched over exhaustively. The original had no shared abstraction at all —
 * a patient's name lived in a {@code JTextField} on a {@code JFrame} subclass
 * and nowhere else.
 */
public abstract sealed class Person permits Patient, StaffMember {

    private final long id;
    private final String fullName;
    private final Gender gender;
    private final String phone;

    protected Person(long id, String fullName, Gender gender, String phone) {
        this.id = id;
        this.fullName = Validate.name(fullName, "full name");
        this.gender = Validate.notNull(gender, "gender");
        this.phone = Validate.phone(phone);
    }

    public long id() {
        return id;
    }

    public String fullName() {
        return fullName;
    }

    public Gender gender() {
        return gender;
    }

    public String phone() {
        return phone;
    }

    /** How this person is addressed on screen, e.g. "Dr. Meera Iyer" or "Anil Rao (MRN HH-000031)". */
    public abstract String displayName();

    /** The hospital-issued identifier for this person: an MRN or a staff code. */
    public abstract String reference();

    protected static int yearsSince(LocalDate date, LocalDate asOf) {
        return Period.between(date, asOf).getYears();
    }
}
