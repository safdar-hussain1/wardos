package com.healthhaven.report;

import com.healthhaven.HealthHaven;
import com.healthhaven.db.Database;
import com.healthhaven.db.MutableClock;
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

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Runs the four correctness scenarios live — the naive implementation beside
 * Health Haven — and returns the results as data.
 *
 * <p>Health Haven's costlier design decisions (parameterised SQL, an invoice that
 * knows about length of stay, discharge as an archive, occupancy derived from
 * admissions) are only worth their price if the cheap alternative really does
 * fail. This class makes that testable rather than rhetorical: it executes
 * {@link NaiveHospital} and the real services on identical inputs and reports
 * what each one did.
 *
 * <p>Every figure the README and the dashboard quote about this comparison is
 * produced here, and nowhere else.
 */
public final class AuditReport {

    public record Finding(String id, String title, String naiveResult, String healthHavenResult, String impact) {
    }

    public List<Finding> run() {
        List<Finding> findings = new ArrayList<>();
        findings.add(sqlInjection());
        findings.add(billing());
        findings.add(dischargeHistory());
        findings.add(doubleBooking());
        return findings;
    }

    private Finding sqlInjection() {
        try (Database db = Database.inMemory(); var c = db.open()) {
            NaiveHospital naive = new NaiveHospital(c);
            naive.addUser("desk", "correct horse battery");
            boolean naiveIn = naive.login("anyone", "' OR '1'='1");

            HealthHaven app = HealthHaven.inMemory();
            app.auth().register("desk", "correct horse battery".toCharArray(), "Front Desk", Role.ADMIN);
            Optional<User> hhIn = app.auth().authenticate("anyone", "' OR '1'='1".toCharArray());

            return new Finding("C1", "Concatenated SQL lets anyone sign in",
                    "Payload \"' OR '1'='1\" signs in: " + naiveIn,
                    "Same payload rejected: " + hhIn.isEmpty() + " (parameterised; bcrypt hashes)",
                    "Anyone could enter the system without an account. Passwords stored in plain text.");
        } catch (Exception e) {
            throw new IllegalStateException("could not run the authentication comparison", e);
        }
    }

    private Finding billing() {
        try (Database db = Database.inMemory(); var c = db.open()) {
            NaiveHospital naive = new NaiveHospital(c);
            naive.addRoom("P-301", "4500");
            // The same call regardless of stay length, because the formula has no
            // parameter for it. That is the entire finding.
            int naiveBill = naive.pendingAmount("P-301", "3000");

            HealthHaven app = seeded();
            Patient p = registerPatient(app);
            long dept = app.departments().findAll().get(0).id();
            var admission = app.admissionService().admit(p, "P-301", dept, "Observation", Money.ofRupees(3_000));
            ((MutableClock) app.clock()).set(Instant.now().plus(Duration.ofDays(20)));
            Invoice bill = app.admissionService().quote(app.admissions().findById(admission.id()).orElseThrow());

            return new Finding("C2", "The bill ignores length of stay",
                    "1-night and 20-night stays both bill ₹" + naiveBill + " (rate − deposit)",
                    "20 nights × ₹4,500 − ₹3,000 deposit = " + bill.balanceDue().format(),
                    "Long stays are under-billed by lakhs; an over-deposit shows as a negative bill.");
        } catch (Exception e) {
            throw new IllegalStateException("could not run the billing comparison", e);
        }
    }

    private Finding dischargeHistory() {
        try (Database db = Database.inMemory(); var c = db.open()) {
            NaiveHospital naive = new NaiveHospital(c);
            naive.addRoom("G-101", "1200");
            naive.admit("AADHAAR", "9999", "Anil Rao", "Male", "Pneumonia", "G-101", "now", "3000");
            naive.discharge("9999", "G-101");
            int naiveRemaining = naive.patientCount();

            HealthHaven app = seeded();
            Patient p = registerPatient(app);
            long dept = app.departments().findAll().get(0).id();
            var admission = app.admissionService().admit(p, "G-101", dept, "Pneumonia", Money.ofRupees(3_000));
            app.admissionService().discharge(app.admissions().findById(admission.id()).orElseThrow());
            boolean kept = app.patients().findByMrn(p.mrn()).isPresent()
                    && app.admissions().findByPatient(p.id()).size() == 1;

            return new Finding("C3", "Discharge deletes the patient",
                    "Patient records remaining after discharge: " + naiveRemaining,
                    "Patient and stay history retained: " + kept + "; invoice issued",
                    "The hospital permanently forgets everyone it discharges.");
        } catch (Exception e) {
            throw new IllegalStateException("could not run the discharge comparison", e);
        }
    }

    private Finding doubleBooking() {
        try (Database db = Database.inMemory(); var c = db.open()) {
            NaiveHospital naive = new NaiveHospital(c);
            naive.addRoom("P-301", "4500");
            naive.admit("AADHAAR", "1", "First", "Male", "A", "P-301", "now", "3000");
            naive.admit("AADHAAR", "2", "Second", "Female", "B", "P-301", "now", "3000");
            int inOneRoom = naive.patientCount();

            HealthHaven app = seeded();
            long dept = app.departments().findAll().get(0).id();
            app.admissionService().admit(registerPatient(app), "P-301", dept, "A", Money.ofRupees(3_000));
            boolean refused;
            try {
                app.admissionService().admit(registerPatient(app), "P-301", dept, "B", Money.ofRupees(3_000));
                refused = false;
            } catch (RuntimeException expected) {
                refused = true;
            }

            return new Finding("C4", "Two patients can share one bed",
                    "Patients admitted to a single room: " + inOneRoom,
                    "Second admission to an occupied room refused: " + refused,
                    "Occupancy is a hand-updated flag, not a fact, so beds get double-booked.");
        } catch (Exception e) {
            throw new IllegalStateException("could not run the occupancy comparison", e);
        }
    }

    /** Each Health Haven scenario needs a department and the two rooms above. */
    private HealthHaven seeded() {
        var app = new HealthHaven(Database.inMemory(), new MutableClock(Instant.now()));
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

    /** The findings as a JSON-ready structure for the dashboard. */
    public List<Map<String, Object>> asData() {
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Finding f : run()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", f.id());
            row.put("title", f.title());
            row.put("naive", f.naiveResult());
            row.put("healthHaven", f.healthHavenResult());
            row.put("impact", f.impact());
            rows.add(row);
        }
        return rows;
    }
}
