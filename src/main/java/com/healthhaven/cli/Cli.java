package com.healthhaven.cli;

import com.healthhaven.AppContext;
import com.healthhaven.HealthHaven;
import com.healthhaven.domain.Admission;
import com.healthhaven.domain.Ambulance;
import com.healthhaven.domain.Money;
import com.healthhaven.domain.Patient;
import com.healthhaven.domain.Room;
import com.healthhaven.domain.StaffMember;
import com.healthhaven.domain.billing.Invoice;
import com.healthhaven.report.AuditReport;
import com.healthhaven.service.ReportingService;

import java.nio.file.Path;
import java.time.Instant;
import java.util.List;

/**
 * A read-eval-print console over the running hospital.
 *
 * <p>It is the quickest way to see the system work end to end without a display:
 * seed a database, list the wards, admit and discharge a patient, print a bill,
 * run the audit. Every command goes through the same services the desktop UI
 * and the REST API use.
 */
public final class Cli {

    private final HealthHaven app;
    private final java.io.PrintStream out;

    public Cli(HealthHaven app, java.io.PrintStream out) {
        this.app = app;
        this.out = out;
    }

    public static void main(String[] args) {
        HealthHaven app = AppContext.openOnDisk(AppContext.defaultDatabasePath());
        Cli cli = new Cli(app, System.out);
        if (args.length == 0) {
            cli.help();
            return;
        }
        cli.dispatch(args);
    }

    public void dispatch(String[] args) {
        String command = args[0];
        String[] rest = java.util.Arrays.copyOfRange(args, 1, args.length);
        switch (command) {
            case "dashboard", "status" -> dashboard();
            case "beds", "rooms" -> beds();
            case "patients" -> patients(rest);
            case "admissions" -> admissions();
            case "staff" -> staff();
            case "payroll" -> payroll();
            case "ambulances" -> ambulances();
            case "bill" -> bill(rest);
            case "audit" -> audit();
            case "help", "--help", "-h" -> help();
            default -> {
                out.println("Unknown command: " + command);
                help();
            }
        }
    }

    private void dashboard() {
        ReportingService r = app.reporting();
        ReportingService.Occupancy occ = r.occupancy();
        rule("HEALTH HAVEN — STATUS");
        out.printf("  Patients registered   %d%n", app.patients().count());
        out.printf("  Currently admitted    %d%n", r.activeAdmissionCount());
        out.printf("  Beds                  %d occupied / %d total (%.0f%% of in-service beds)%n",
                occ.occupied(), occ.total(), occ.occupancyRate() * 100);
        out.printf("  Mean completed stay   %.1f nights%n", r.meanCompletedStayNights());
        out.printf("  Total billed          %s%n", r.totalBilled().format());
        out.printf("  Outstanding           %s%n", r.outstanding().format());
        out.printf("  Monthly payroll       %s%n", app.staffService().monthlyPayroll().format());
        out.println();
        out.println("  Department load (active admissions):");
        r.activeLoadByDepartment().forEach((dept, n) -> out.printf("    %-20s %d%n", dept, n));
    }

    private void beds() {
        rule("WARDS");
        out.printf("  %-10s %-14s %-6s %-12s %s%n", "ROOM", "TYPE", "FLOOR", "RATE/NIGHT", "STATE");
        for (Room room : app.rooms().findAll()) {
            boolean occupied = app.admissions().findActiveByRoom(room.roomNo()).isPresent();
            String state = room.outOfService() ? "out of service" : occupied ? "OCCUPIED" : "available";
            out.printf("  %-10s %-14s %-6d %-12s %s%n",
                    room.roomNo(), room.type().label(), room.floor(), room.nightlyRate().format(), state);
        }
    }

    private void patients(String[] rest) {
        String term = rest.length > 0 ? String.join(" ", rest) : "";
        List<Patient> found = app.patientService().search(term);
        rule("PATIENTS" + (term.isEmpty() ? "" : " matching \"" + term + "\""));
        out.printf("  %-12s %-24s %-6s %-8s %s%n", "MRN", "NAME", "AGE", "GENDER", "ID");
        for (Patient p : found) {
            out.printf("  %-12s %-24s %-6d %-8s %s%n",
                    p.mrn(), p.fullName(), p.age(), p.gender(), p.maskedId());
        }
        out.printf("%n  %d patient(s).%n", found.size());
    }

    private void admissions() {
        rule("ACTIVE ADMISSIONS");
        out.printf("  %-6s %-24s %-10s %-6s %s%n", "ADM#", "PATIENT", "ROOM", "NIGHTS", "DIAGNOSIS");
        for (Admission a : app.admissions().findActive()) {
            Patient p = app.patients().findById(a.patientId()).orElseThrow();
            out.printf("  %-6d %-24s %-10s %-6d %s%n",
                    a.id(), p.fullName(), a.roomNo(), a.billableNights(Instant.now()), a.diagnosis());
        }
    }

    private void staff() {
        rule("STAFF DIRECTORY");
        out.printf("  %-10s %-22s %-14s %-16s %s%n", "CODE", "NAME", "ROLE", "MONTHLY PAY", "ALLOWANCE");
        for (StaffMember s : app.staffService().directory()) {
            out.printf("  %-10s %-22s %-14s %-16s %s%n",
                    s.staffCode(), s.displayName(), s.role().label(), s.monthlyPay().format(), s.allowanceNote());
        }
    }

    private void payroll() {
        rule("MONTHLY PAYROLL");
        app.staffService().headcountByRole().forEach((role, count) ->
                out.printf("  %-14s %d%n", role.label(), count));
        out.printf("%n  Total monthly payroll: %s%n", app.staffService().monthlyPayroll().format());
    }

    private void ambulances() {
        rule("AMBULANCE FLEET");
        out.printf("  %-16s %-20s %-14s %s%n", "VEHICLE", "DRIVER", "STATUS", "BASE");
        for (Ambulance a : app.ambulanceService().fleet()) {
            out.printf("  %-16s %-20s %-14s %s%n",
                    a.vehicleNo(), a.driverName(), a.status(), a.baseLocation());
        }
    }

    private void bill(String[] rest) {
        if (rest.length == 0) {
            out.println("Usage: bill <admission-id>");
            return;
        }
        long id = Long.parseLong(rest[0]);
        Admission admission = app.admissions().findById(id)
                .orElseThrow(() -> new IllegalArgumentException("no admission #" + id));
        Invoice invoice = app.admissionService().quote(admission);
        out.println();
        out.println(invoice.render());
    }

    private void audit() {
        rule("SECURITY & CORRECTNESS AUDIT — original vs rebuilt");
        for (AuditReport.Finding f : new AuditReport().run()) {
            out.printf("%n  [%s] %s%n", f.id(), f.title());
            out.printf("      original : %s%n", f.legacyResult());
            out.printf("      rebuilt  : %s%n", f.rebuiltResult());
            out.printf("      impact   : %s%n", f.impact());
        }
        out.println();
    }

    private void help() {
        rule("HEALTH HAVEN CLI");
        out.println("""
                  dashboard          hospital status at a glance
                  beds               every room and its current state
                  patients [term]    list or search patients
                  admissions         who is currently admitted
                  staff              directory with computed monthly pay
                  payroll            headcount and total monthly payroll
                  ambulances         the fleet and its status
                  bill <adm#>        print the current bill for an admission
                  audit              run the original-vs-rebuilt audit
                  help               this message
                """);
        out.println("  Data lives in " + Path.of("data", "health-haven.db").toAbsolutePath());
    }

    private void rule(String title) {
        out.println();
        out.println("== " + title + " " + "=".repeat(Math.max(0, 60 - title.length())));
    }
}
