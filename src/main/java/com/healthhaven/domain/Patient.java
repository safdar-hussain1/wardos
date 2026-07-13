package com.healthhaven.domain;

import com.healthhaven.validation.Validate;

import java.time.Instant;
import java.time.LocalDate;

/**
 * A person the hospital has registered.
 *
 * <p>Two decisions here are deliberate and worth naming.
 *
 * <p>First, the primary key is a hospital-issued medical record number, not the
 * patient's Aadhaar number. Keying rows on whatever government ID was typed into
 * the form makes the identity document the join key across the whole database,
 * and a patient who presents a different card on their next visit becomes a
 * different person.
 *
 * <p>Second, only the last four digits of that document are retained. The
 * hospital needs to confirm which card it saw; it does not need to store it.
 */
public final class Patient extends Person {

    private final String mrn;
    private final LocalDate dateOfBirth;
    private final IdKind idKind;
    private final String idLast4;
    private final Instant registeredAt;

    public Patient(long id,
                   String mrn,
                   String fullName,
                   Gender gender,
                   LocalDate dateOfBirth,
                   String phone,
                   IdKind idKind,
                   String idLast4,
                   Instant registeredAt) {
        super(id, fullName, gender, phone);
        this.mrn = Validate.notBlank(mrn, "MRN");
        this.dateOfBirth = Validate.pastDate(dateOfBirth, "date of birth");
        this.idKind = Validate.notNull(idKind, "ID kind");
        this.idLast4 = Validate.digits(idLast4, 4, "ID last 4 digits");
        this.registeredAt = Validate.notNull(registeredAt, "registered at");
    }

    public String mrn() {
        return mrn;
    }

    public LocalDate dateOfBirth() {
        return dateOfBirth;
    }

    public IdKind idKind() {
        return idKind;
    }

    /** e.g. "AADHAAR ····4417". Enough to check the card, not enough to be worth stealing. */
    public String maskedId() {
        return idKind + " ····" + idLast4;
    }

    public String idLast4() {
        return idLast4;
    }

    public Instant registeredAt() {
        return registeredAt;
    }

    public int ageOn(LocalDate asOf) {
        return yearsSince(dateOfBirth, asOf);
    }

    public int age() {
        return ageOn(LocalDate.now());
    }

    @Override
    public String displayName() {
        return fullName() + " (" + mrn + ")";
    }

    @Override
    public String reference() {
        return mrn;
    }

    public enum IdKind {
        AADHAAR, VOTER_ID, DRIVING_LICENCE, PASSPORT
    }
}
