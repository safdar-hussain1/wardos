package com.healthhaven.report;

import com.healthhaven.HealthHaven;
import com.healthhaven.domain.Admission;
import com.healthhaven.domain.Money;
import com.healthhaven.domain.Room;
import com.healthhaven.domain.RoomType;
import com.healthhaven.domain.StaffMember;
import com.healthhaven.domain.StaffRole;
import com.healthhaven.domain.billing.ChargeKind;
import com.healthhaven.repository.InvoiceRepository;
import com.healthhaven.service.ReportingService;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Exports the live state of a seeded hospital to {@code docs/data/dashboard.json}
 * — the single file the GitHub Pages dashboard reads.
 *
 * <p>Every figure the dashboard shows is computed here from the same services
 * the application uses, so the web page and the running system can never
 * disagree. Nothing on the dashboard is hand-entered.
 */
public final class DashboardExporter {

    private final HealthHaven app;

    public DashboardExporter(HealthHaven app) {
        this.app = app;
    }

    public void exportTo(Path outputFile) throws IOException {
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("generatedAt", Instant.now().toString());
        root.put("summary", summary());
        root.put("beds", bedGrid());
        root.put("occupancyByType", occupancyByType());
        root.put("revenueMix", revenueMix());
        root.put("departmentLoad", departmentLoad());
        root.put("admissionsTrend", admissionsTrend());
        root.put("payroll", payroll());
        root.put("staff", staffDirectory());
        root.put("tariff", tariff());
        root.put("sampleInvoice", sampleInvoice());
        root.put("billingImpact", billingImpact());
        root.put("audit", new AuditReport().asData());

        Path parent = outputFile.toAbsolutePath().getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        Files.writeString(outputFile, Json.write(root), StandardCharsets.UTF_8);
    }

    private Map<String, Object> summary() {
        ReportingService reporting = app.reporting();
        ReportingService.Occupancy occ = reporting.occupancy();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("patients", app.patients().count());
        m.put("activeAdmissions", reporting.activeAdmissionCount());
        m.put("totalRooms", occ.total());
        m.put("occupiedRooms", occ.occupied());
        m.put("availableRooms", occ.available());
        m.put("occupancyRate", round(occ.occupancyRate() * 100));
        m.put("staff", app.staff().findAll().size());
        m.put("totalBilledRupees", rupees(reporting.totalBilled()));
        m.put("outstandingRupees", rupees(reporting.outstanding()));
        m.put("monthlyPayrollRupees", rupees(app.staffService().monthlyPayroll()));
        m.put("meanStayNights", round(reporting.meanCompletedStayNights()));
        m.put("invoices", app.invoices().findAll().size());
        return m;
    }

    /** Every bed, in floor order, with its current state — the data behind the ward grid. */
    private List<Map<String, Object>> bedGrid() {
        Map<String, Admission> activeByRoom = new java.util.HashMap<>();
        for (Admission a : app.admissions().findActive()) {
            activeByRoom.put(a.roomNo(), a);
        }
        List<Map<String, Object>> beds = new ArrayList<>();
        for (Room room : app.rooms().findAll()) {
            Map<String, Object> bed = new LinkedHashMap<>();
            bed.put("room", room.roomNo());
            bed.put("type", room.type().name());
            bed.put("floor", room.floor());
            bed.put("rate", rupees(room.nightlyRate()));
            String state = room.outOfService() ? "OUT_OF_SERVICE"
                    : activeByRoom.containsKey(room.roomNo()) ? "OCCUPIED" : "AVAILABLE";
            bed.put("state", state);
            if (state.equals("OCCUPIED")) {
                Admission a = activeByRoom.get(room.roomNo());
                long nights = a.billableNights(Instant.now());
                bed.put("nights", nights);
                bed.put("diagnosis", a.diagnosis());
            }
            beds.add(bed);
        }
        return beds;
    }

    private List<Map<String, Object>> occupancyByType() {
        List<Map<String, Object>> out = new ArrayList<>();
        ReportingService.Occupancy occ = app.reporting().occupancy();
        for (RoomType type : RoomType.values()) {
            ReportingService.TypeOccupancy t = occ.byType().get(type);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("type", type.label());
            row.put("total", t.total());
            row.put("occupied", t.occupied());
            row.put("available", t.available());
            out.add(row);
        }
        return out;
    }

    private List<Map<String, Object>> revenueMix() {
        List<Map<String, Object>> out = new ArrayList<>();
        Map<ChargeKind, Money> mix = app.reporting().revenueMix();
        for (Map.Entry<ChargeKind, Money> e : mix.entrySet()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("kind", e.getKey().label());
            row.put("rupees", rupees(e.getValue()));
            out.add(row);
        }
        return out;
    }

    private List<Map<String, Object>> departmentLoad() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map.Entry<String, Long> e : app.reporting().activeLoadByDepartment().entrySet()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("department", e.getKey());
            row.put("active", e.getValue());
            out.add(row);
        }
        return out;
    }

    /** Admissions per day over the last 30 days, for the trend line. */
    private List<Map<String, Object>> admissionsTrend() {
        Map<LocalDate, Long> byDay = new TreeMap<>();
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        LocalDate from = today.minusDays(29);
        for (LocalDate d = from; !d.isAfter(today); d = d.plusDays(1)) {
            byDay.put(d, 0L);
        }
        for (Admission a : app.admissions().findAll()) {
            LocalDate day = a.admittedAt().atZone(ZoneOffset.UTC).toLocalDate();
            if (!day.isBefore(from) && !day.isAfter(today)) {
                byDay.merge(day, 1L, Long::sum);
            }
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map.Entry<LocalDate, Long> e : byDay.entrySet()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("date", e.getKey().toString());
            row.put("count", e.getValue());
            out.add(row);
        }
        return out;
    }

    private List<Map<String, Object>> payroll() {
        Map<StaffRole, List<StaffMember>> byRole = new LinkedHashMap<>();
        for (StaffMember m : app.staff().findAll()) {
            byRole.computeIfAbsent(m.role(), k -> new ArrayList<>()).add(m);
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (StaffRole role : StaffRole.values()) {
            List<StaffMember> members = byRole.getOrDefault(role, List.of());
            if (members.isEmpty()) {
                continue;
            }
            Money total = app.staffService().monthlyPayroll(members);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("role", role.label());
            row.put("count", members.size());
            row.put("monthlyRupees", rupees(total));
            out.add(row);
        }
        return out;
    }

    /**
     * What the original's billing formula would have charged, across every
     * invoice this hospital has actually issued, beside what the correct formula
     * charges.
     *
     * <p>The old expression was {@code nightlyRate − deposit}. The nightly rate
     * is recoverable from a stored invoice as {@code roomTotal / nights}, so the
     * original's number can be reconstructed for every real stay and the two
     * totals compared. The gap is the revenue the original silently gave away.
     */
    private Map<String, Object> billingImpact() {
        long correctPaise = 0;
        long legacyPaise = 0;
        long negativeBills = 0;
        List<InvoiceRepository.StoredInvoice> invoices = app.invoices().findAll();
        for (InvoiceRepository.StoredInvoice inv : invoices) {
            correctPaise += inv.grossTotal().paise();

            long nightlyPaise = inv.roomTotal().paise() / Math.max(1, inv.nights());
            long legacyPending = nightlyPaise - inv.deposit().paise();
            // The original showed this figure as the amount owed, sign and all.
            legacyPaise += nightlyPaise;
            if (legacyPending < 0) {
                negativeBills++;
            }
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("invoices", invoices.size());
        m.put("correctGrossRupees", correctPaise / 100);
        m.put("legacyGrossRupees", legacyPaise / 100);
        m.put("shortfallRupees", (correctPaise - legacyPaise) / 100);
        m.put("shortfallPct", correctPaise == 0 ? 0
                : round((correctPaise - legacyPaise) * 100.0 / correctPaise));
        m.put("negativeBills", negativeBills);
        return m;
    }

    /**
     * Every staff member with their base salary and the pay their own class
     * computes from it. This is the polymorphism made visible: the base is
     * stored, the total never is.
     */
    private List<Map<String, Object>> staffDirectory() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (StaffMember s : app.staffService().directory()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("code", s.staffCode());
            row.put("name", s.displayName());
            row.put("role", s.role().label());
            row.put("type", s.getClass().getSimpleName());
            row.put("baseRupees", rupees(s.baseSalary()));
            row.put("allowance", s.allowanceNote());
            row.put("payRupees", rupees(s.monthlyPay()));
            out.add(row);
        }
        return out;
    }

    /** A real invoice the system has issued, line by line, exactly as it prints. */
    private Map<String, Object> sampleInvoice() {
        Map<String, Object> m = new LinkedHashMap<>();
        // The largest issued invoice makes the clearest example: several charge kinds.
        InvoiceRepository.StoredInvoice pick = app.invoices().findAll().stream()
                .max((a, b) -> Long.compare(a.grossTotal().paise(), b.grossTotal().paise()))
                .orElse(null);
        if (pick == null) {
            return m;
        }
        Admission admission = app.admissions().findById(pick.admissionId()).orElseThrow();
        Room room = app.rooms().findByNumber(admission.roomNo()).orElseThrow();

        List<Map<String, Object>> lines = new ArrayList<>();
        Map<String, Object> roomLine = new LinkedHashMap<>();
        roomLine.put("kind", ChargeKind.ROOM.label());
        roomLine.put("description", "Room " + room.roomNo() + " — " + pick.nights()
                + (pick.nights() == 1 ? " night" : " nights"));
        roomLine.put("quantity", pick.nights());
        roomLine.put("unitRupees", rupees(room.nightlyRate()));
        roomLine.put("totalRupees", rupees(pick.roomTotal()));
        lines.add(roomLine);

        for (var charge : app.charges().findByAdmission(admission.id())) {
            Map<String, Object> line = new LinkedHashMap<>();
            line.put("kind", charge.kind().label());
            line.put("description", charge.description());
            line.put("quantity", charge.quantity());
            line.put("unitRupees", rupees(charge.unitAmount()));
            line.put("totalRupees", rupees(charge.lineTotal()));
            lines.add(line);
        }

        m.put("admissionId", pick.admissionId());
        m.put("room", room.roomNo());
        m.put("ward", room.type().label());
        m.put("diagnosis", admission.diagnosis());
        m.put("nights", pick.nights());
        m.put("lines", lines);
        m.put("roomTotalRupees", rupees(pick.roomTotal()));
        m.put("extrasTotalRupees", rupees(pick.extrasTotal()));
        m.put("grossTotalRupees", rupees(pick.grossTotal()));
        m.put("depositRupees", rupees(pick.deposit()));
        m.put("balanceRupees", rupees(pick.balanceDue()));
        // What the original's formula would have printed for this very stay.
        long nightlyRupees = rupees(room.nightlyRate());
        m.put("legacyBalanceRupees", nightlyRupees - rupees(pick.deposit()));
        return m;
    }

    private List<Map<String, Object>> tariff() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (RoomType type : RoomType.values()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("type", type.label());
            row.put("nightlyRupees", rupees(type.standardNightlyRate()));
            out.add(row);
        }
        return out;
    }

    private static long rupees(Money money) {
        return money.paise() / 100;
    }

    private static double round(double value) {
        return Math.round(value * 10.0) / 10.0;
    }

    @SuppressWarnings("unused")
    private static long daysBetween(Instant a, Instant b) {
        return ChronoUnit.DAYS.between(a, b);
    }
}
