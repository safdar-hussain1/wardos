package com.healthhaven;

import com.healthhaven.db.Database;
import com.healthhaven.repository.AdmissionRepository;
import com.healthhaven.repository.AmbulanceRepository;
import com.healthhaven.repository.AuditRepository;
import com.healthhaven.repository.ChargeRepository;
import com.healthhaven.repository.DepartmentRepository;
import com.healthhaven.repository.InvoiceRepository;
import com.healthhaven.repository.PatientRepository;
import com.healthhaven.repository.RoomRepository;
import com.healthhaven.repository.StaffRepository;
import com.healthhaven.repository.UserRepository;
import com.healthhaven.repository.jdbc.JdbcAdmissionRepository;
import com.healthhaven.repository.jdbc.JdbcAmbulanceRepository;
import com.healthhaven.repository.jdbc.JdbcAuditRepository;
import com.healthhaven.repository.jdbc.JdbcChargeRepository;
import com.healthhaven.repository.jdbc.JdbcDepartmentRepository;
import com.healthhaven.repository.jdbc.JdbcInvoiceRepository;
import com.healthhaven.repository.jdbc.JdbcPatientRepository;
import com.healthhaven.repository.jdbc.JdbcRoomRepository;
import com.healthhaven.repository.jdbc.JdbcStaffRepository;
import com.healthhaven.repository.jdbc.JdbcUserRepository;
import com.healthhaven.service.AdmissionService;
import com.healthhaven.service.AmbulanceService;
import com.healthhaven.service.AuthService;
import com.healthhaven.service.BillingService;
import com.healthhaven.service.PasswordHasher;
import com.healthhaven.service.PatientService;
import com.healthhaven.service.ReportingService;
import com.healthhaven.service.StaffService;

import java.time.Clock;

/**
 * The composition root: the one place where concrete repositories and services
 * are wired to a {@link Database}.
 *
 * <p>Every layer above depends on interfaces, so this class is the only thing
 * that knows the persistence is JDBC and SQLite. Swap it for another
 * implementation and nothing in the services or the UI changes. The original had
 * no such seam — every screen did {@code new Connect()} and wrote its own SQL,
 * so the database was welded to the UI in forty places.
 */
public final class HealthHaven {

    private final Database database;
    private final Clock clock;

    private final PatientRepository patients;
    private final RoomRepository rooms;
    private final AdmissionRepository admissions;
    private final ChargeRepository charges;
    private final InvoiceRepository invoices;
    private final StaffRepository staff;
    private final DepartmentRepository departments;
    private final UserRepository users;
    private final AmbulanceRepository ambulances;
    private final AuditRepository audit;

    private final AuthService authService;
    private final PatientService patientService;
    private final BillingService billingService;
    private final AdmissionService admissionService;
    private final StaffService staffService;
    private final ReportingService reportingService;
    private final AmbulanceService ambulanceService;

    public HealthHaven(Database database, Clock clock) {
        this.database = database;
        this.clock = clock;

        this.patients = new JdbcPatientRepository(database);
        this.rooms = new JdbcRoomRepository(database);
        this.admissions = new JdbcAdmissionRepository(database);
        this.charges = new JdbcChargeRepository(database);
        this.invoices = new JdbcInvoiceRepository(database);
        this.staff = new JdbcStaffRepository(database);
        this.departments = new JdbcDepartmentRepository(database);
        this.users = new JdbcUserRepository(database);
        this.ambulances = new JdbcAmbulanceRepository(database);
        this.audit = new JdbcAuditRepository(database);

        PasswordHasher hasher = new PasswordHasher();
        this.authService = new AuthService(users, hasher);
        this.patientService = new PatientService(patients, clock);
        this.billingService = new BillingService();
        this.admissionService = new AdmissionService(database, admissions, rooms, charges, invoices, billingService, clock);
        this.staffService = new StaffService(staff);
        this.reportingService = new ReportingService(rooms, admissions, charges, invoices, departments, clock);
        this.ambulanceService = new AmbulanceService(ambulances, clock);
    }

    public static HealthHaven inMemory() {
        return new HealthHaven(Database.inMemory(), Clock.systemUTC());
    }

    public Database database() {
        return database;
    }

    public Clock clock() {
        return clock;
    }

    public PatientRepository patients() {
        return patients;
    }

    public RoomRepository rooms() {
        return rooms;
    }

    public AdmissionRepository admissions() {
        return admissions;
    }

    public ChargeRepository charges() {
        return charges;
    }

    public InvoiceRepository invoices() {
        return invoices;
    }

    public StaffRepository staff() {
        return staff;
    }

    public DepartmentRepository departments() {
        return departments;
    }

    public UserRepository users() {
        return users;
    }

    public AmbulanceRepository ambulances() {
        return ambulances;
    }

    public AuditRepository audit() {
        return audit;
    }

    public AuthService auth() {
        return authService;
    }

    public PatientService patientService() {
        return patientService;
    }

    public BillingService billing() {
        return billingService;
    }

    public AdmissionService admissionService() {
        return admissionService;
    }

    public StaffService staffService() {
        return staffService;
    }

    public ReportingService reporting() {
        return reportingService;
    }

    public AmbulanceService ambulanceService() {
        return ambulanceService;
    }
}
