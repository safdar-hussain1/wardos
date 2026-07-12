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
import com.healthhaven.legacy.LegacyHospital;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Runs the four audit findings live — the original's logic beside the rebuilt
 * system — and returns the results as data.
 *
 * <p>This is the project's equivalent of a results table: every row is produced
 * by actually executing both versions here, never asserted from memory. The CLI
 * prints it; the dashboard exporter serialises it.
 */
public final class AuditReport {

    public record Finding(String id, String title, String legacyResult, String rebuiltResult, String impact) {
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
            LegacyHospital legacy = new LegacyHospital(c);
            legacy.addUser("safdarhussain", "se22ucse085");
            boolean legacyIn = legacy.login("anyone", "' OR '1'='1");

            HealthHaven app = HealthHaven.inMemory();
            app.auth().register("safdarhussain", "se22ucse085!".toCharArray(), "Safdar Hussain", Role.ADMIN);
            Optional<User> rebuiltIn = app.auth().authenticate("anyone", "' OR '1'='1".toCharArray());

            return new Finding("F1", "Login accepted SQL injection",
                    "Payload \"' OR '1'='1\" logs in: " + legacyIn,
                    "Same payload rejected: " + rebuiltIn.isEmpty() + " (passwords bcrypt-hashed)",
                    "Anyone could enter the system without a valid account.");
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private Finding billing() {
        try (Database db = Database.inMemory(); var c = db.open()) {
            LegacyHospital legacy = new LegacyHospital(c);
            legacy.addRoom("P-301", "4500");
            int legacyShort = legacy.pendingAmount("P-301", "3000");   // 1 "night"
            int legacyLong = legacy.pendingAmount("P-301", "3000");    // 20-night stay, same input

            HealthHaven app = seeded();
            Patient p = registerPatient(app);
            long dept = app.departments().findAll().get(0).id();
            var admission = app.admissionService().admit(p, "P-301", dept, "Observation", Money.ofRupees(3_000));
            ((MutableClock) app.clock()).set(Instant.now().plus(Duration.ofDays(20)));
            Invoice bill = app.admissionService().quote(app.admissions().findById(admission.id()).orElseThrow());

            return new Finding("F2", "Bill ignored length of stay",
                    "1-night and 20-night stays both bill ₹" + (legacyShort) + " (rate − deposit)",
                    "20 nights × ₹4,500 − ₹3,000 deposit = " + bill.balanceDue().format(),
                    "Long stays were under-billed by lakhs; over-deposits showed as negative bills.");
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private Finding dischargeHistory() {
        try (Database db = Database.inMemory(); var c = db.open()) {
            LegacyHospital legacy = new LegacyHospital(c);
            legacy.addRoom("G-101", "1200");
            legacy.admit("AADHAAR", "9999", "Anil Rao", "Male", "Pneumonia", "G-101", "now", "3000");
            legacy.discharge("9999", "G-101");
            int legacyRemaining = legacy.patientCount();

            HealthHaven app = seeded();
            Patient p = registerPatient(app);
            long dept = app.departments().findAll().get(0).id();
            var admission = app.admissionService().admit(p, "G-101", dept, "Pneumonia", Money.ofRupees(3_000));
            app.admissionService().discharge(app.admissions().findById(admission.id()).orElseThrow());
            boolean kept = app.patients().findByMrn(p.mrn()).isPresent()
                    && app.admissions().findByPatient(p.id()).size() == 1;

            return new Finding("F3", "Discharge deleted the patient",
                    "After discharge, patient records remaining: " + legacyRemaining,
                    "Patient and stay history retained: " + kept + "; invoice issued",
                    "The hospital lost every discharged patient's record permanently.");
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private Finding doubleBooking() {
        try (Database db = Database.inMemory(); var c = db.open()) {
            LegacyHospital legacy = new LegacyHospital(c);
            legacy.addRoom("P-301", "4500");
            legacy.admit("AADHAAR", "1", "First", "Male", "A", "P-301", "now", "3000");
            legacy.admit("AADHAAR", "2", "Second", "Female", "B", "P-301", "now", "3000");
            int inOneRoom = legacy.patientCount();

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

            return new Finding("F4", "Two patients could share one bed",
                    "Patients admitted to one room: " + inOneRoom,
                    "Second admission to occupied room refused: " + refused,
                    "Occupancy was a hand-updated flag, not a fact; beds were double-booked.");
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    // Each rebuilt scenario needs two rooms and a department.
    private HealthHaven seeded() {
        var app = new HealthHaven(Database.inMemory(), new MutableClock(Instant.now()));
        app.departments().insert(new Department(0, "General Medicine", "Dr. Test", "A-1", "Internal", "+91 40 1234 5678"));
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
            row.put("legacy", f.legacyResult());
            row.put("rebuilt", f.rebuiltResult());
            row.put("impact", f.impact());
            rows.add(row);
        }
        return rows;
    }
}
