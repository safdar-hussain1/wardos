package com.healthhaven.service;

import com.healthhaven.domain.Admission;
import com.healthhaven.domain.Department;
import com.healthhaven.domain.Money;
import com.healthhaven.domain.Room;
import com.healthhaven.domain.RoomType;
import com.healthhaven.domain.billing.ChargeKind;
import com.healthhaven.domain.billing.ExtraCharge;
import com.healthhaven.repository.AdmissionRepository;
import com.healthhaven.repository.ChargeRepository;
import com.healthhaven.repository.DepartmentRepository;
import com.healthhaven.repository.InvoiceRepository;
import com.healthhaven.repository.RoomRepository;

import java.time.Clock;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Read-only analytics over the whole hospital, computed from the live tables.
 *
 * <p>Everything here is derived on demand. Storing occupancy and
 * doctor-counts as columns that drifted; these numbers cannot drift because they
 * are queries.
 */
public final class ReportingService {

    private final RoomRepository rooms;
    private final AdmissionRepository admissions;
    private final ChargeRepository charges;
    private final InvoiceRepository invoices;
    private final DepartmentRepository departments;
    private final Clock clock;

    public ReportingService(RoomRepository rooms,
                            AdmissionRepository admissions,
                            ChargeRepository charges,
                            InvoiceRepository invoices,
                            DepartmentRepository departments,
                            Clock clock) {
        this.rooms = rooms;
        this.admissions = admissions;
        this.charges = charges;
        this.invoices = invoices;
        this.departments = departments;
        this.clock = clock;
    }

    public Occupancy occupancy() {
        List<Room> all = rooms.findAll();
        int total = all.size();
        int outOfService = (int) all.stream().filter(Room::outOfService).count();
        int occupied = rooms.findOccupied().size();
        int available = total - occupied - outOfService;
        Map<RoomType, TypeOccupancy> byType = new LinkedHashMap<>();
        for (RoomType type : RoomType.values()) {
            long typeTotal = all.stream().filter(r -> r.type() == type).count();
            long typeAvail = rooms.findAvailable(type).size();
            byType.put(type, new TypeOccupancy(type, (int) typeTotal,
                    (int) (typeTotal - typeAvail), (int) typeAvail));
        }
        return new Occupancy(total, occupied, available, outOfService, byType);
    }

    /** Revenue banked so far, grouped by charge kind, from the issued invoices and their extras. */
    public Map<ChargeKind, Money> revenueMix() {
        Map<ChargeKind, Money> mix = new LinkedHashMap<>();
        for (ChargeKind kind : ChargeKind.values()) {
            mix.put(kind, Money.ZERO);
        }
        for (InvoiceRepository.StoredInvoice inv : invoices.findAll()) {
            mix.merge(ChargeKind.ROOM, inv.roomTotal(), Money::plus);
        }
        for (ExtraCharge charge : charges.findAll()) {
            mix.merge(charge.kind(), charge.lineTotal(), Money::plus);
        }
        return mix;
    }

    public Money totalBilled() {
        return invoices.findAll().stream()
                .map(InvoiceRepository.StoredInvoice::grossTotal)
                .reduce(Money.ZERO, Money::plus);
    }

    public Money outstanding() {
        return invoices.findAll().stream()
                .filter(i -> !i.settled())
                .map(InvoiceRepository.StoredInvoice::balanceDue)
                .filter(m -> !m.isNegative())
                .reduce(Money.ZERO, Money::plus);
    }

    /** Active-admission load per department, so a busy unit is visible at a glance. */
    public Map<String, Long> activeLoadByDepartment() {
        Map<Long, String> names = new java.util.HashMap<>();
        for (Department d : departments.findAll()) {
            names.put(d.id(), d.name());
        }
        Map<String, Long> load = new TreeMap<>();
        for (Admission a : admissions.findActive()) {
            load.merge(names.getOrDefault(a.departmentId(), "Unknown"), 1L, Long::sum);
        }
        return load;
    }

    /** Mean length of the stays that have already ended, in nights. */
    public double meanCompletedStayNights() {
        List<Admission> ended = admissions.findAll().stream()
                .filter(a -> a.dischargedAt().isPresent())
                .toList();
        if (ended.isEmpty()) {
            return 0;
        }
        double totalHours = ended.stream()
                .mapToDouble(a -> Duration.between(a.admittedAt(), a.dischargedAt().orElseThrow()).toHours())
                .sum();
        return (totalHours / 24.0) / ended.size();
    }

    public int activeAdmissionCount() {
        return admissions.findActive().size();
    }

    public record Occupancy(int total, int occupied, int available, int outOfService,
                            Map<RoomType, TypeOccupancy> byType) {
        public double occupancyRate() {
            int inService = total - outOfService;
            return inService == 0 ? 0 : (double) occupied / inService;
        }
    }

    public record TypeOccupancy(RoomType type, int total, int occupied, int available) {
    }
}
