package com.healthhaven.repository;

import com.healthhaven.HealthHaven;
import com.healthhaven.db.Database;
import com.healthhaven.db.MutableClock;
import com.healthhaven.domain.Ambulance;
import com.healthhaven.domain.Doctor;
import com.healthhaven.domain.Gender;
import com.healthhaven.domain.Money;
import com.healthhaven.domain.Nurse;
import com.healthhaven.domain.Patient;
import com.healthhaven.domain.Room;
import com.healthhaven.domain.RoomType;
import com.healthhaven.domain.StaffMember;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RepositoryIntegrationTest {

    private HealthHaven app;

    @BeforeEach
    void setUp() {
        app = new HealthHaven(Database.inMemory(), new MutableClock(Instant.parse("2026-01-01T00:00:00Z")));
        app.departments().insert(new com.healthhaven.domain.Department(0, "General Medicine",
                "Dr. Test", "A-1", "Internal", "+91 40 1234 5678"));
    }

    @Test
    void mrnIncrementsAcrossRegistrations() {
        Patient first = register("Anil Rao");
        Patient second = register("Sunita Das");
        assertThat(first.mrn()).isEqualTo("HH-000001");
        assertThat(second.mrn()).isEqualTo("HH-000002");
    }

    @Test
    void staffRoundTripsAsItsConcreteType() {
        app.staff().insert(new Doctor(profile("EMP-001", 180_000), "Cardiology"));
        app.staff().insert(new Nurse(profile("EMP-002", 60_000), "ICU"));

        var loaded = app.staff().findAll();
        assertThat(loaded).hasSize(2);
        assertThat(loaded).anySatisfy(s -> assertThat(s).isInstanceOf(Doctor.class));
        assertThat(loaded).anySatisfy(s -> assertThat(s).isInstanceOf(Nurse.class));
    }

    @Test
    void availabilityIsDerivedFromActiveAdmissions() {
        app.rooms().insert(Room.standard("G-101", RoomType.GENERAL, 1));
        assertThat(app.rooms().findAvailable()).extracting(Room::roomNo).contains("G-101");

        long dept = app.departments().findAll().get(0).id();
        var admission = app.admissionService().admit(register("Anil Rao"), "G-101", dept, "obs", Money.ofRupees(3_000));
        assertThat(app.rooms().findAvailable()).extracting(Room::roomNo).doesNotContain("G-101");
        assertThat(app.rooms().findOccupied()).extracting(Room::roomNo).contains("G-101");

        app.admissionService().discharge(admission);
        assertThat(app.rooms().findAvailable()).extracting(Room::roomNo).contains("G-101");
    }

    @Test
    void ambulanceCannotBeDispatchedTwice() {
        Ambulance a = app.ambulances().insert(new Ambulance(0, "TS-1", "Driver", "+91 90000 00000",
                Ambulance.Status.AVAILABLE, "Bay"));
        app.ambulanceService().dispatch(a.id(), "MG Road");
        assertThatThrownBy(() -> app.ambulanceService().dispatch(a.id(), "Elsewhere"))
                .isInstanceOf(IllegalStateException.class);
        app.ambulanceService().recall(a.id());
        assertThat(app.ambulances().findById(a.id()).orElseThrow().status())
                .isEqualTo(Ambulance.Status.AVAILABLE);
    }

    private Patient register(String name) {
        return app.patientService().register(name, Gender.MALE, LocalDate.of(1990, 1, 1),
                "+91 90000 00000", Patient.IdKind.AADHAAR, "1234");
    }

    private StaffMember.Profile profile(String code, long baseRupees) {
        return new StaffMember.Profile(0, code, "Test Person", Gender.OTHER,
                "+91 90000 00000", "t@healthhaven.example", app.departments().findAll().get(0).id(),
                Money.ofRupees(baseRupees), LocalDate.of(2018, 1, 1));
    }
}
