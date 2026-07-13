package com.healthhaven.domain;

import com.healthhaven.validation.ValidationException;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Without fail-fast constructors, whatever was typed goes into the INSERT and the
 * problem surfaces, if at all, as a stack trace on a console nobody is watching.
 * These assert that bad input is refused at construction, so an invalid object
 * can never reach the database in the first place.
 */
class ValidationTest {

    @Test
    void patientRejectsBlankNameAndMalformedId() {
        assertThatThrownBy(() -> newPatient("", "1234"))
                .isInstanceOf(ValidationException.class);
        assertThatThrownBy(() -> newPatient("Anil Rao", "12"))     // must be 4 digits
                .isInstanceOf(ValidationException.class);
    }

    @Test
    void patientAcceptsValidInput() {
        assertThatCode(() -> newPatient("Anil Rao", "4417")).doesNotThrowAnyException();
    }

    @Test
    void roomNumberMustMatchThePattern() {
        assertThatThrownBy(() -> Room.standard("hello", RoomType.GENERAL, 1))
                .isInstanceOf(ValidationException.class);
        assertThatCode(() -> Room.standard("ICU-401", RoomType.ICU, 4)).doesNotThrowAnyException();
    }

    @Test
    void depositCannotBeNegative() {
        assertThatThrownBy(() -> new Admission(1, 1, "G-101", 1, "obs",
                Instant.now(), null, Money.ofPaise(-1)))
                .isInstanceOf(ValidationException.class);
    }

    private Patient newPatient(String name, String idLast4) {
        return new Patient(0, "HH-000001", name, Gender.MALE, LocalDate.of(1990, 1, 1),
                "+91 90000 00000", Patient.IdKind.AADHAAR, idLast4, Instant.now());
    }
}
