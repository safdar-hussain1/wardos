package com.healthhaven.audit;

import com.healthhaven.HealthHaven;
import com.healthhaven.db.Database;
import com.healthhaven.db.MutableClock;
import com.healthhaven.domain.Admission;
import com.healthhaven.domain.Department;
import com.healthhaven.domain.Gender;
import com.healthhaven.domain.Money;
import com.healthhaven.domain.Patient;
import com.healthhaven.domain.Role;
import com.healthhaven.domain.Room;
import com.healthhaven.domain.RoomType;
import com.healthhaven.domain.User;
import com.healthhaven.domain.billing.Invoice;
import com.healthhaven.naive.NaiveHospital;
import com.healthhaven.service.AdmissionException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Why Health Haven is built the way it is, expressed as tests.
 *
 * <p>Several of this system's design decisions cost more than the obvious
 * alternative: parameterised SQL, an invoice that knows about length of stay,
 * discharge as an archive, occupancy derived from admissions. Each nested class
 * below runs the obvious alternative via {@link NaiveHospital}, asserts that it
 * really does fail, and then asserts that Health Haven does not.
 *
 * <p>They are paired on purpose. A test that only asserts the right answer tells
 * you the code works; a test that first demonstrates the wrong answer tells you
 * why the code is shaped the way it is — and stops anyone "simplifying" it back.
 */
class NaiveApproachComparisonTest {

    /** A raw SQLite connection for the naive implementation to abuse. */
    private Connection naiveConnection() {
        return Database.inMemory().open();
    }

    @Nested
    @DisplayName("C1 — concatenated SQL lets anyone sign in")
    class SqlInjection {

        @Test
        @DisplayName("naive: a crafted password signs in with no valid credentials")
        void naiveLetsInjectionThrough() {
            NaiveHospital naive = new NaiveHospital(naiveConnection());
            naive.addUser("desk", "correct horse battery");

            // Closes the password string and appends a tautology, so the WHERE
            // clause matches every row in the table.
            boolean signedIn = naive.login("anyone", "' OR '1'='1");

            assertThat(signedIn)
                    .as("a concatenated query treats the payload as SQL, not as a value")
                    .isTrue();
        }

        @Test
        @DisplayName("Health Haven: the same payload is rejected; the real password works")
        void healthHavenResistsInjection() {
            HealthHaven app = HealthHaven.inMemory();
            app.auth().register("desk", "correct horse battery".toCharArray(), "Front Desk", Role.ADMIN);

            Optional<User> viaInjection = app.auth().authenticate("anyone", "' OR '1'='1".toCharArray());
            Optional<User> viaWrongPassword = app.auth().authenticate("desk", "wrong".toCharArray());
            Optional<User> viaRealPassword = app.auth().authenticate("desk", "correct horse battery".toCharArray());

            assertThat(viaInjection).as("the payload is a value, never SQL").isEmpty();
            assertThat(viaWrongPassword).isEmpty();
            assertThat(viaRealPassword).map(User::username).contains("desk");
        }

        @Test
        @DisplayName("Health Haven: passwords are stored as bcrypt hashes, not plain text")
        void passwordsAreHashed() {
            HealthHaven app = HealthHaven.inMemory();
            app.auth().register("desk", "supersecret".toCharArray(), "Desk", Role.RECEPTIONIST);

            String stored = app.users().findActiveHash("desk").orElseThrow();

            assertThat(stored).startsWith("$2");              // a bcrypt hash
            assertThat(stored).doesNotContain("supersecret"); // the password is nowhere in it
        }
    }

    @Nested
    @DisplayName("C2 — the bill ignores length of stay")
    class Billing {

        @Test
        @DisplayName("naive: a 1-night and a 20-night stay in the same room bill the same")
        void naiveIgnoresLengthOfStay() {
            NaiveHospital naive = new NaiveHospital(naiveConnection());
            naive.addRoom("P-301", "4500");   // ₹4,500 per night

            // There is no argument for the length of stay, because the formula has
            // no place to put one. That is the whole defect.
            int shortStay = naive.pendingAmount("P-301", "3000");
            int longStay = naive.pendingAmount("P-301", "3000");

            assertThat(longStay)
                    .as("length of stay never enters the naive formula")
                    .isEqualTo(shortStay)
                    .isEqualTo(4500 - 3000);   // one night's rate, minus the deposit
        }

        @Test
        @DisplayName("naive: a deposit above one night's rate produces a negative bill")
        void naiveGoesNegative() {
            NaiveHospital naive = new NaiveHospital(naiveConnection());
            naive.addRoom("G-101", "1200");

            int pending = naive.pendingAmount("G-101", "5000");

            assertThat(pending)
                    .as("₹1,200 − ₹5,000, displayed to the clerk as the amount due")
                    .isNegative()
                    .isEqualTo(1200 - 5000);
        }

        @Test
        @DisplayName("Health Haven: the bill scales with nights and nets the deposit")
        void healthHavenBillsByLengthOfStay() {
            Instant admitted = Instant.parse("2026-01-01T08:00:00Z");
            HealthHaven app = seededApp(admitted);
            Patient patient = registerPatient(app);

            Admission admission = app.admissionService().admit(patient, "P-301",
                    app.departments().findAll().get(0).id(), "Observation", Money.ofRupees(3_000));

            ((MutableClock) app.clock()).set(admitted.plus(Duration.ofDays(4)));
            Invoice bill = app.admissionService().quote(app.admissions().findById(admission.id()).orElseThrow());

            assertThat(bill.nights()).isEqualTo(4);
            assertThat(bill.roomTotal()).isEqualTo(Money.ofRupees(4 * 4_500));
            assertThat(bill.balanceDue()).isEqualTo(Money.ofRupees(4 * 4_500 - 3_000));
        }

        @Test
        @DisplayName("Health Haven: an over-deposit is reported as a refund, not a negative balance")
        void healthHavenReportsRefund() {
            HealthHaven app = seededApp(Instant.parse("2026-01-01T08:00:00Z"));
            Patient patient = registerPatient(app);

            Admission admission = app.admissionService().admit(patient, "G-101",
                    app.departments().findAll().get(0).id(), "Overnight", Money.ofRupees(5_000));

            Invoice bill = app.admissionService().quote(admission);   // one night at ₹1,200

            assertThat(bill.isRefund()).isTrue();
            assertThat(bill.refundDue()).isEqualTo(Money.ofRupees(5_000 - 1_200));
        }
    }

    @Nested
    @DisplayName("C3 — discharge deletes the patient")
    class DischargeErasesHistory {

        @Test
        @DisplayName("naive: after discharge the patient no longer exists")
        void naiveDeletesOnDischarge() {
            NaiveHospital naive = new NaiveHospital(naiveConnection());
            naive.addRoom("G-101", "1200");
            naive.admit("AADHAAR", "9999", "Anil Rao", "Male", "Pneumonia", "G-101", "now", "3000");
            assertThat(naive.patientCount()).isEqualTo(1);

            naive.discharge("9999", "G-101");

            assertThat(naive.patientCount())
                    .as("deleting the stay deletes the person, because they are the same row")
                    .isZero();
        }

        @Test
        @DisplayName("Health Haven: discharge closes the stay and keeps the patient and their history")
        void healthHavenKeepsHistory() {
            HealthHaven app = seededApp(Instant.parse("2026-01-01T08:00:00Z"));
            Patient patient = registerPatient(app);
            Admission admission = app.admissionService().admit(patient, "G-101",
                    app.departments().findAll().get(0).id(), "Pneumonia", Money.ofRupees(3_000));

            app.admissionService().discharge(app.admissions().findById(admission.id()).orElseThrow());

            assertThat(app.patients().findByMrn(patient.mrn())).isPresent();
            List<Admission> history = app.admissions().findByPatient(patient.id());
            assertThat(history).hasSize(1);
            assertThat(history.get(0).isActive()).isFalse();
            assertThat(app.invoices().findByAdmission(admission.id())).isPresent();
        }
    }

    @Nested
    @DisplayName("C4 — two patients can share one bed")
    class DoubleBooking {

        @Test
        @DisplayName("naive: nothing stops a second admission into an occupied room")
        void naiveAllowsDoubleBooking() {
            NaiveHospital naive = new NaiveHospital(naiveConnection());
            naive.addRoom("P-301", "4500");
            naive.admit("AADHAAR", "1", "First Patient", "Male", "A", "P-301", "now", "3000");
            naive.admit("AADHAAR", "2", "Second Patient", "Female", "B", "P-301", "now", "3000");

            assertThat(naive.patientCount())
                    .as("both inserts succeed; the room now holds two people")
                    .isEqualTo(2);
        }

        @Test
        @DisplayName("Health Haven: a second admission into an occupied room is refused")
        void healthHavenRefusesDoubleBooking() {
            HealthHaven app = seededApp(Instant.parse("2026-01-01T08:00:00Z"));
            long dept = app.departments().findAll().get(0).id();
            app.admissionService().admit(registerPatient(app), "P-301", dept, "A", Money.ofRupees(3_000));

            Patient second = registerPatient(app);
            assertThatThrownBy(() -> app.admissionService().admit(second, "P-301", dept, "B", Money.ofRupees(3_000)))
                    .isInstanceOf(AdmissionException.class)
                    .hasMessageContaining("occupied");
        }
    }

    // -- helpers --------------------------------------------------------------

    private HealthHaven seededApp(Instant now) {
        HealthHaven app = new HealthHaven(Database.inMemory(), new MutableClock(now));
        app.departments().insert(new Department(0, "General Medicine", "Dr. Test", "A-1",
                "Internal", "+91 40 1234 5678"));
        app.rooms().insert(Room.standard("P-301", RoomType.PRIVATE, 3));
        app.rooms().insert(Room.standard("G-101", RoomType.GENERAL, 1));
        return app;
    }

    private Patient registerPatient(HealthHaven app) {
        return app.patientService().register("Test Patient", Gender.OTHER,
                LocalDate.of(1990, 1, 1), "+91 90000 00000", Patient.IdKind.AADHAAR, "1234");
    }
}
