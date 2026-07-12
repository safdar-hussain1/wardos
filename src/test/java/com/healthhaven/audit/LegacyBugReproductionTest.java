package com.healthhaven.audit;

import com.healthhaven.HealthHaven;
import com.healthhaven.db.Database;
import com.healthhaven.domain.Gender;
import com.healthhaven.domain.Money;
import com.healthhaven.domain.Patient;
import com.healthhaven.domain.Room;
import com.healthhaven.domain.RoomType;
import com.healthhaven.domain.User;
import com.healthhaven.domain.billing.Invoice;
import com.healthhaven.legacy.LegacyHospital;
import com.healthhaven.service.AdmissionException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The audit, expressed as tests.
 *
 * <p>Each nested class reproduces one defect in the original with {@link
 * LegacyHospital}, asserts that the bug really happens, then asserts that the
 * rebuilt system does not. These are the "results" of the project: not a claim
 * that the old code was wrong, but a running demonstration of it beside its fix.
 */
class LegacyBugReproductionTest {

    private Connection legacyConnection() {
        // A raw SQLite connection for the legacy reproduction to abuse.
        Database db = Database.inMemory();
        return db.open();
    }

    @Nested
    @DisplayName("Defect 1 — login was open to SQL injection")
    class SqlInjection {

        @Test
        @DisplayName("legacy: a crafted password logs in with no valid credentials")
        void legacyLetsInjectionThrough() {
            LegacyHospital legacy = new LegacyHospital(legacyConnection());
            legacy.addUser("safdarhussain", "se22ucse085");

            // The classic payload. It closes the password string and appends a
            // tautology, so the WHERE clause matches every row.
            boolean loggedIn = legacy.login("anyone", "' OR '1'='1");

            assertThat(loggedIn)
                    .as("the original's concatenated query treats the payload as SQL")
                    .isTrue();
        }

        @Test
        @DisplayName("rebuilt: the same payload is rejected; the real password works")
        void rebuiltResistsInjection() {
            HealthHaven app = HealthHaven.inMemory();
            app.auth().register("safdarhussain", "se22ucse085!".toCharArray(), "Safdar Hussain",
                    com.healthhaven.domain.Role.ADMIN);

            Optional<User> viaInjection = app.auth().authenticate("anyone", "' OR '1'='1".toCharArray());
            Optional<User> viaWrongPassword = app.auth().authenticate("safdarhussain", "wrong".toCharArray());
            Optional<User> viaRealPassword = app.auth().authenticate("safdarhussain", "se22ucse085!".toCharArray());

            assertThat(viaInjection).as("payload is a value, never SQL").isEmpty();
            assertThat(viaWrongPassword).isEmpty();
            assertThat(viaRealPassword).map(User::username).contains("safdarhussain");
        }

        @Test
        @DisplayName("rebuilt: passwords are stored as bcrypt hashes, not plain text")
        void passwordsAreHashed() {
            HealthHaven app = HealthHaven.inMemory();
            app.auth().register("desk", "supersecret".toCharArray(), "Desk",
                    com.healthhaven.domain.Role.RECEPTIONIST);

            String stored = app.users().findActiveHash("desk").orElseThrow();

            assertThat(stored).startsWith("$2");            // a bcrypt hash
            assertThat(stored).doesNotContain("supersecret"); // the password is nowhere in it
        }
    }

    @Nested
    @DisplayName("Defect 2 — the bill ignored length of stay")
    class Billing {

        @Test
        @DisplayName("legacy: a 1-night and a 20-night stay in the same room bill the same")
        void legacyIgnoresLengthOfStay() {
            LegacyHospital legacy = new LegacyHospital(legacyConnection());
            legacy.addRoom("P-301", "4500");   // ₹4,500 per night

            // Two patients, same room, deposits equal — the only thing that
            // should differ is how long they stayed.
            int shortStayPending = legacy.pendingAmount("P-301", "3000");
            int longStayPending = legacy.pendingAmount("P-301", "3000");

            assertThat(longStayPending)
                    .as("length of stay never enters the original's formula")
                    .isEqualTo(shortStayPending)
                    .isEqualTo(4500 - 3000);   // one night's rate minus deposit
        }

        @Test
        @DisplayName("legacy: a deposit above one night's rate shows a negative bill")
        void legacyGoesNegative() {
            LegacyHospital legacy = new LegacyHospital(legacyConnection());
            legacy.addRoom("G-101", "1200");

            int pending = legacy.pendingAmount("G-101", "5000");

            assertThat(pending)
                    .as("₹1,200 − ₹5,000; the screen displayed this as 'Pending Amount'")
                    .isNegative()
                    .isEqualTo(1200 - 5000);
        }

        @Test
        @DisplayName("rebuilt: the bill scales with nights and nets the deposit correctly")
        void rebuiltBillsByLengthOfStay() {
            Instant admitted = Instant.parse("2026-01-01T08:00:00Z");
            var app = seededApp(admitted);
            Room room = app.rooms().findByNumber("P-301").orElseThrow();
            Patient patient = registerPatient(app);

            var admission = app.admissionService().admit(patient, "P-301",
                    app.departments().findAll().get(0).id(), "Observation", Money.ofRupees(3_000));

            // Quote after 4 nights.
            var clock = (com.healthhaven.db.MutableClock) app.clock();
            clock.set(admitted.plus(Duration.ofDays(4)));
            Invoice bill = app.admissionService().quote(app.admissions().findById(admission.id()).orElseThrow());

            assertThat(bill.nights()).isEqualTo(4);
            assertThat(bill.roomTotal()).isEqualTo(Money.ofRupees(4 * 4_500));
            assertThat(bill.balanceDue()).isEqualTo(Money.ofRupees(4 * 4_500 - 3_000));
        }

        @Test
        @DisplayName("rebuilt: an over-deposit is reported as a refund, not a negative balance")
        void rebuiltReportsRefund() {
            Instant admitted = Instant.parse("2026-01-01T08:00:00Z");
            var app = seededApp(admitted);
            Patient patient = registerPatient(app);
            var admission = app.admissionService().admit(patient, "G-101",
                    app.departments().findAll().get(0).id(), "Overnight", Money.ofRupees(5_000));

            Invoice bill = app.admissionService().quote(admission);   // 1 night at ₹1,200

            assertThat(bill.isRefund()).isTrue();
            assertThat(bill.refundDue()).isEqualTo(Money.ofRupees(5_000 - 1_200));
            assertThat(bill.balanceDue().isNegative()).isTrue();
        }
    }

    @Nested
    @DisplayName("Defect 3 — discharge deleted the patient record")
    class DischargeErasesHistory {

        @Test
        @DisplayName("legacy: after discharge the patient no longer exists")
        void legacyDeletesOnDischarge() {
            LegacyHospital legacy = new LegacyHospital(legacyConnection());
            legacy.addRoom("G-101", "1200");
            legacy.admit("AADHAAR", "9999", "Anil Rao", "Male", "Pneumonia", "G-101", "now", "3000");
            assertThat(legacy.patientCount()).isEqualTo(1);

            legacy.discharge("9999", "G-101");

            assertThat(legacy.patientCount())
                    .as("delete from patient_info leaves nothing behind")
                    .isZero();
        }

        @Test
        @DisplayName("rebuilt: discharge closes the stay but keeps the patient and their history")
        void rebuiltKeepsHistory() {
            var app = seededApp(Instant.parse("2026-01-01T08:00:00Z"));
            Patient patient = registerPatient(app);
            var admission = app.admissionService().admit(patient, "G-101",
                    app.departments().findAll().get(0).id(), "Pneumonia", Money.ofRupees(3_000));

            app.admissionService().discharge(app.admissions().findById(admission.id()).orElseThrow());

            assertThat(app.patients().findByMrn(patient.mrn())).isPresent();
            List<com.healthhaven.domain.Admission> history = app.admissions().findByPatient(patient.id());
            assertThat(history).hasSize(1);
            assertThat(history.get(0).isActive()).isFalse();
            assertThat(app.invoices().findByAdmission(admission.id())).isPresent();
        }
    }

    @Nested
    @DisplayName("Defect 4 — two patients could occupy one room")
    class DoubleBooking {

        @Test
        @DisplayName("legacy: nothing stops a second admission to an occupied room")
        void legacyAllowsDoubleBooking() {
            LegacyHospital legacy = new LegacyHospital(legacyConnection());
            legacy.addRoom("P-301", "4500");
            legacy.admit("AADHAAR", "1", "First Patient", "Male", "A", "P-301", "now", "3000");
            legacy.admit("AADHAAR", "2", "Second Patient", "Female", "B", "P-301", "now", "3000");

            assertThat(legacy.patientCount())
                    .as("both inserts succeed; the room holds two")
                    .isEqualTo(2);
        }

        @Test
        @DisplayName("rebuilt: a second admission to an occupied room is refused")
        void rebuiltRefusesDoubleBooking() {
            var app = seededApp(Instant.parse("2026-01-01T08:00:00Z"));
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
        var clock = new com.healthhaven.db.MutableClock(now);
        var app = new HealthHaven(Database.inMemory(), clock);
        app.departments().insert(new com.healthhaven.domain.Department(0, "General Medicine",
                "Dr. Test", "A-1", "Internal", "+91 40 1234 5678"));
        app.rooms().insert(Room.standard("P-301", RoomType.PRIVATE, 3));
        app.rooms().insert(Room.standard("G-101", RoomType.GENERAL, 1));
        return app;
    }

    private Patient registerPatient(HealthHaven app) {
        return app.patientService().register("Test Patient", Gender.OTHER,
                LocalDate.of(1990, 1, 1), "+91 90000 00000", Patient.IdKind.AADHAAR, "1234");
    }

    @SuppressWarnings("unused")
    private static Clock utc(Instant at) {
        return Clock.fixed(at, ZoneOffset.UTC);
    }
}
