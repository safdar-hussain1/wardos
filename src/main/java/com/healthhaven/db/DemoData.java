package com.healthhaven.db;

import com.healthhaven.HealthHaven;
import com.healthhaven.domain.AdminStaff;
import com.healthhaven.domain.Ambulance;
import com.healthhaven.domain.Department;
import com.healthhaven.domain.Doctor;
import com.healthhaven.domain.Driver;
import com.healthhaven.domain.Gender;
import com.healthhaven.domain.Money;
import com.healthhaven.domain.Nurse;
import com.healthhaven.domain.Patient;
import com.healthhaven.domain.Room;
import com.healthhaven.domain.RoomType;
import com.healthhaven.domain.StaffMember;
import com.healthhaven.domain.Technician;
import com.healthhaven.domain.Admission;
import com.healthhaven.domain.Role;
import com.healthhaven.domain.billing.ChargeKind;
import com.healthhaven.service.AdmissionService;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/**
 * Loads a realistic, self-consistent hospital into an empty database:
 * departments, staff, rooms, an ambulance fleet, a back-catalogue of completed
 * stays (so the reports have history), and a set of patients currently admitted.
 *
 * <p>It is deterministic — seeded with a fixed {@link Random} — so the demo, the
 * dashboard data and the screenshots are identical on every run and on every
 * machine. Together with {@link Database}'s self-building schema, this is what
 * lets anyone clone the repository and immediately see a working hospital with
 * six months of history in it, rather than an empty set of tables.
 */
public final class DemoData {

    private final HealthHaven app;
    private final MutableClock clock;
    private final Random random = new Random(85);   // fixed: the demo must not drift between runs

    /**
     * @param app   an application wired to the same {@code clock}
     * @param clock the seeding clock, wound forward as stays progress and left at
     *              "now" when loading finishes
     */
    public DemoData(HealthHaven app, MutableClock clock) {
        this.app = app;
        this.clock = clock;
    }

    public void load() {
        if (app.users().count() > 0) {
            return;   // already seeded
        }
        seedUsers();
        List<Department> departments = seedDepartments();
        seedStaff(departments);
        List<Room> rooms = seedRooms();
        seedAmbulances();
        seedStays(departments, rooms);
    }

    private void seedUsers() {
        app.auth().register("admin", "aurora@35".toCharArray(), "Safdar Hussain", Role.ADMIN);
        app.auth().register("reception", "changeme-desk".toCharArray(), "Front Desk", Role.RECEPTIONIST);
        app.auth().register("dr.iyer", "changeme-doc1".toCharArray(), "Meera Iyer", Role.DOCTOR);
    }

    private List<Department> seedDepartments() {
        record Dept(String name, String head, String location, String spec, String phone) {
        }
        List<Dept> defs = List.of(
                new Dept("Cardiology", "Dr. Meera Iyer", "Block A, Floor 3", "Heart & vascular", "+91 40 2345 6001"),
                new Dept("Orthopaedics", "Dr. Rohan Nair", "Block B, Floor 2", "Bones & joints", "+91 40 2345 6002"),
                new Dept("Paediatrics", "Dr. Anjali Rao", "Block A, Floor 1", "Child health", "+91 40 2345 6003"),
                new Dept("Neurology", "Dr. Sameer Khan", "Block C, Floor 4", "Brain & nerves", "+91 40 2345 6004"),
                new Dept("General Medicine", "Dr. Kavya Menon", "Block A, Floor 2", "Internal medicine", "+91 40 2345 6005"),
                new Dept("Emergency", "Dr. Vikram Sethi", "Ground Floor", "Acute & trauma care", "+91 40 2345 6000"));
        List<Department> saved = new ArrayList<>();
        for (Dept d : defs) {
            saved.add(app.departments().insert(new Department(0, d.name(), d.head(), d.location(), d.spec(), d.phone())));
        }
        return saved;
    }

    private void seedStaff(List<Department> departments) {
        long cardiology = departments.get(0).id();
        long ortho = departments.get(1).id();
        long paeds = departments.get(2).id();
        long neuro = departments.get(3).id();
        long general = departments.get(4).id();
        long emergency = departments.get(5).id();

        int seq = 1;
        insert(doctor(seq++, "Meera Iyer", Gender.FEMALE, cardiology, 180_000, "Interventional cardiology", 2015));
        insert(doctor(seq++, "Rohan Nair", Gender.MALE, ortho, 165_000, "Joint replacement", 2017));
        insert(doctor(seq++, "Anjali Rao", Gender.FEMALE, paeds, 155_000, "Neonatology", 2019));
        insert(doctor(seq++, "Sameer Khan", Gender.MALE, neuro, 190_000, "Stroke medicine", 2014));
        insert(doctor(seq++, "Kavya Menon", Gender.FEMALE, general, 140_000, "Diabetology", 2020));
        insert(doctor(seq++, "Vikram Sethi", Gender.MALE, emergency, 175_000, "Emergency medicine", 2016));

        insert(nurse(seq++, "Priya Deshpande", Gender.FEMALE, emergency, 62_000, "Emergency"));
        insert(nurse(seq++, "Fatima Sheikh", Gender.FEMALE, cardiology, 58_000, "ICU"));
        insert(nurse(seq++, "Neha Gupta", Gender.FEMALE, paeds, 52_000, "Paediatric ward"));
        insert(nurse(seq++, "Arjun Pillai", Gender.MALE, general, 50_000, "General ward"));

        insert(new Technician(profile(seq++, "Suresh Babu", Gender.MALE, neuro, 48_000, 2018)));
        insert(new Technician(profile(seq++, "Divya Nambiar", Gender.FEMALE, cardiology, 46_000, 2021)));

        insert(new Driver(profile(seq++, "Ganesh Reddy", Gender.MALE, emergency, 32_000, 2019), "TS-DL-2019-4471"));
        insert(new Driver(profile(seq++, "Iqbal Ahmed", Gender.MALE, emergency, 31_000, 2020), "TS-DL-2020-8823"));

        insert(new AdminStaff(profile(seq, "Lakshmi Rao", Gender.FEMALE, general, 40_000, 2018)));
    }

    private Doctor doctor(int seq, String name, Gender g, long deptId, long baseRupees, String specialty, int joinYear) {
        return new Doctor(profile(seq, name, g, deptId, baseRupees, joinYear), specialty);
    }

    private Nurse nurse(int seq, String name, Gender g, long deptId, long baseRupees, String ward) {
        return new Nurse(profile(seq, name, g, deptId, baseRupees, 2019), ward);
    }

    private StaffMember.Profile profile(int seq, String name, Gender g, long deptId, long baseRupees, int joinYear) {
        String first = name.split(" ")[0].toLowerCase();
        return new StaffMember.Profile(0, String.format("EMP-%03d", seq), name, g,
                "+91 98" + String.format("%08d", 40_000_000 + seq * 137L),
                first + "@healthhaven.example",
                deptId, Money.ofRupees(baseRupees),
                LocalDate.of(joinYear, 1 + (seq % 12), 1 + (seq % 27)));
    }

    private void insert(StaffMember member) {
        app.staff().insert(member);
    }

    private List<Room> seedRooms() {
        List<Room> saved = new ArrayList<>();
        saved.addAll(makeRooms("G", RoomType.GENERAL, 1, 12));
        saved.addAll(makeRooms("SP", RoomType.SEMI_PRIVATE, 2, 8));
        saved.addAll(makeRooms("P", RoomType.PRIVATE, 3, 6));
        saved.addAll(makeRooms("ICU", RoomType.ICU, 4, 4));
        return saved;
    }

    private List<Room> makeRooms(String prefix, RoomType type, int floor, int count) {
        List<Room> saved = new ArrayList<>();
        for (int i = 1; i <= count; i++) {
            Room room = Room.standard(String.format("%s-%03d", prefix, floor * 100 + i), type, floor);
            app.rooms().insert(room);
            saved.add(room);
        }
        return saved;
    }

    private void seedAmbulances() {
        app.ambulances().insert(new Ambulance(0, "TS07-UA-1191", "Ganesh Reddy", "+91 99000 11223",
                Ambulance.Status.AVAILABLE, "Emergency bay"));
        app.ambulances().insert(new Ambulance(0, "TS07-UA-1192", "Iqbal Ahmed", "+91 99000 11224",
                Ambulance.Status.AVAILABLE, "Emergency bay"));
        app.ambulances().insert(new Ambulance(0, "TS07-UA-1193", "Relief driver", "+91 99000 11225",
                Ambulance.Status.MAINTENANCE, "Workshop"));
    }

    private void seedStays(List<Department> departments, List<Room> rooms) {
        String[] first = {"Anil", "Sunita", "Ravi", "Deepa", "Manoj", "Pooja", "Karthik", "Sneha",
                "Ramesh", "Anita", "Vijay", "Lata", "Farhan", "Nisha", "Gopal", "Rekha",
                "Aditya", "Meghna", "Sanjay", "Preeti", "Harish", "Kiran", "Naveen", "Shalini"};
        String[] last = {"Rao", "Sharma", "Reddy", "Nair", "Khan", "Menon", "Gupta", "Patel",
                "Iyer", "Das", "Verma", "Pillai"};
        String[] diagnoses = {"Acute myocardial infarction", "Fractured femur", "Bronchiolitis",
                "Ischaemic stroke", "Type 2 diabetes review", "Appendicitis", "Pneumonia",
                "Hypertensive crisis", "Dengue fever", "Cardiac arrhythmia"};
        Patient.IdKind[] idKinds = Patient.IdKind.values();
        AdmissionService admit = app.admissionService();

        List<Room> shuffledRooms = new ArrayList<>(rooms);
        java.util.Collections.shuffle(shuffledRooms, random);

        Instant realNow = Instant.now();

        // 40 completed stays spread across the last ~120 days, each 1-14 nights.
        // The clock is wound to the admission date, then forward to the discharge
        // date, so every stay bills a genuine length rather than a same-day night.
        for (int i = 0; i < 40; i++) {
            int daysAgo = 8 + random.nextInt(112);
            int nights = 1 + random.nextInt(14);
            Instant admittedAt = realNow.minus(Duration.ofDays(daysAgo));
            clock.set(admittedAt);
            Patient patient = registerPatient(first, last, idKinds, i);
            Room room = freeRoomAt(shuffledRooms);
            if (room == null) {
                continue;
            }
            long deptId = departments.get(random.nextInt(departments.size())).id();
            long deposit = 5_000 + random.nextInt(20) * 1_000L;
            Admission a = admit.admit(patient, room.roomNo(), deptId,
                    diagnoses[random.nextInt(diagnoses.length)], Money.ofRupees(deposit));
            addRandomCharges(a, room.type());
            clock.set(admittedAt.plus(Duration.ofDays(nights)).plus(Duration.ofHours(random.nextInt(12))));
            admit.discharge(a);
        }

        // 18 patients currently admitted, each admitted 0-9 nights ago and still in.
        for (int i = 0; i < 18; i++) {
            int daysAgo = random.nextInt(10);
            Instant admittedAt = realNow.minus(Duration.ofDays(daysAgo)).minus(Duration.ofHours(random.nextInt(20)));
            clock.set(admittedAt);
            Patient patient = registerPatient(first, last, idKinds, 100 + i);
            Room room = freeRoomAt(shuffledRooms);
            if (room == null) {
                break;
            }
            long deptId = departments.get(random.nextInt(departments.size())).id();
            long deposit = 8_000 + random.nextInt(25) * 1_000L;
            Admission a = admit.admit(patient, room.roomNo(), deptId,
                    diagnoses[random.nextInt(diagnoses.length)], Money.ofRupees(deposit));
            addRandomCharges(a, room.type());
        }

        clock.set(realNow);   // hand the running system a clock that reads "now"
    }

    private Patient registerPatient(String[] first, String[] last, Patient.IdKind[] idKinds, int i) {
        String name = first[random.nextInt(first.length)] + " " + last[random.nextInt(last.length)];
        Gender gender = random.nextBoolean() ? Gender.MALE : Gender.FEMALE;
        LocalDate dob = LocalDate.now().minusDays(365L * (5 + random.nextInt(80)) + random.nextInt(365));
        String phone = "+91 90" + String.format("%08d", 10_000_000 + i * 971L);
        Patient.IdKind kind = idKinds[random.nextInt(idKinds.length)];
        String last4 = String.format("%04d", random.nextInt(10_000));
        return app.patientService().register(name, gender, dob, phone, kind, last4);
    }

    private Room freeRoomAt(List<Room> pool) {
        for (Room room : pool) {
            if (app.admissions().findActiveByRoom(room.roomNo()).isEmpty() && !room.outOfService()) {
                return room;
            }
        }
        return null;
    }

    private void addRandomCharges(Admission admission, RoomType type) {
        AdmissionService admit = app.admissionService();
        if (random.nextDouble() < 0.8) {
            admit.recordCharge(admission, ChargeKind.CONSULTATION, "Specialist consultation",
                    1 + random.nextInt(3), Money.ofRupees(800));
        }
        if (random.nextDouble() < 0.7) {
            admit.recordCharge(admission, ChargeKind.PHARMACY, "Ward pharmacy",
                    1, Money.ofRupees(500 + random.nextInt(40) * 100L));
        }
        if (random.nextDouble() < 0.5) {
            admit.recordCharge(admission, ChargeKind.PROCEDURE,
                    type == RoomType.ICU ? "Ventilator support" : "Diagnostic imaging",
                    1, Money.ofRupees(2_000 + random.nextInt(60) * 500L));
        }
        if (random.nextDouble() < 0.2) {
            admit.recordCharge(admission, ChargeKind.AMBULANCE, "Ambulance transfer",
                    1, Money.ofRupees(1_500));
        }
    }
}
