package com.healthhaven.service;

import com.healthhaven.db.DataAccessException;
import com.healthhaven.db.Database;
import com.healthhaven.domain.Admission;
import com.healthhaven.domain.Money;
import com.healthhaven.domain.Patient;
import com.healthhaven.domain.Room;
import com.healthhaven.domain.billing.ChargeKind;
import com.healthhaven.domain.billing.ExtraCharge;
import com.healthhaven.domain.billing.Invoice;
import com.healthhaven.repository.AdmissionRepository;
import com.healthhaven.repository.ChargeRepository;
import com.healthhaven.repository.InvoiceRepository;
import com.healthhaven.repository.RoomRepository;

import java.time.Clock;
import java.time.Instant;
import java.util.List;

/**
 * Admits, discharges, and records charges against stays.
 *
 * <p>This service holds the two operations that are easiest to get wrong.
 *
 * <p><b>Admit.</b> The obvious version does two writes — insert the patient row, then
 * {@code update room set Availability='Occupied'} — with nothing tying them
 * together and nothing stopping a second admission to the same room. Here,
 * admitting is a <em>single</em> insert into {@code admissions}; occupancy is
 * derived, so there is no second write to fall out of step, and a partial unique
 * index makes a double-booking impossible at the database level. The pre-checks
 * below turn that raw constraint violation into a clear domain error.
 *
 * <p><b>Discharge.</b> The obvious version runs {@code delete from patient}, losing
 * the record. Here discharge issues the invoice and closes the stay in one
 * transaction, and the patient and their history remain.
 */
public final class AdmissionService {

    private final Database db;
    private final AdmissionRepository admissions;
    private final RoomRepository rooms;
    private final ChargeRepository charges;
    private final InvoiceRepository invoices;
    private final BillingService billing;
    private final Clock clock;

    public AdmissionService(Database db,
                            AdmissionRepository admissions,
                            RoomRepository rooms,
                            ChargeRepository charges,
                            InvoiceRepository invoices,
                            BillingService billing,
                            Clock clock) {
        this.db = db;
        this.admissions = admissions;
        this.rooms = rooms;
        this.charges = charges;
        this.invoices = invoices;
        this.billing = billing;
        this.clock = clock;
    }

    public Admission admit(Patient patient, String roomNo, long departmentId, String diagnosis, Money deposit) {
        Room room = rooms.findByNumber(roomNo)
                .orElseThrow(() -> new AdmissionException("no such room: " + roomNo));
        if (room.outOfService()) {
            throw new AdmissionException("room " + roomNo + " is out of service");
        }
        if (admissions.findActiveByRoom(roomNo).isPresent()) {
            throw new AdmissionException("room " + roomNo + " is already occupied");
        }
        if (admissions.findActiveByPatient(patient.id()).isPresent()) {
            throw new AdmissionException(patient.displayName() + " is already admitted");
        }
        Admission draft = new Admission(0, patient.id(), roomNo, departmentId, diagnosis,
                clock.instant(), null, deposit);
        try {
            return admissions.insert(draft);
        } catch (DataAccessException e) {
            // Lost the race to the unique index between the check above and the
            // insert. The database is the real guard; report it cleanly.
            throw new AdmissionException("room " + roomNo + " was taken a moment ago; pick another", e);
        }
    }

    public ExtraCharge recordCharge(Admission admission, ChargeKind kind, String description,
                                    int quantity, Money unitAmount) {
        if (!admission.isActive()) {
            throw new AdmissionException("cannot add charges to a discharged stay");
        }
        return charges.insert(new ExtraCharge(0, admission.id(), kind, description,
                quantity, unitAmount, clock.instant()));
    }

    /**
     * A preview of the current bill for an active stay, without discharging.
     * The desk can quote a running total at any time — a system that only prices
     * ever show a single night's rate.
     */
    public Invoice quote(Admission admission) {
        Room room = rooms.findByNumber(admission.roomNo()).orElseThrow();
        return billing.priceStay(admission, room, charges.findByAdmission(admission.id()), clock.instant());
    }

    /**
     * Closes a stay: prices it, writes the invoice, and marks the admission
     * discharged — all in one transaction, so a stay is never left half-closed.
     */
    public Invoice discharge(Admission admission) {
        Room room = rooms.findByNumber(admission.roomNo()).orElseThrow();
        List<ExtraCharge> extras = charges.findByAdmission(admission.id());
        Instant now = clock.instant();
        Admission closed = admission.dischargedAt(now);
        Invoice invoice = billing.priceStay(closed, room, extras, now);
        return db.inTransaction(c -> {
            admissions.markDischarged(c, admission.id(), now);
            invoices.insert(c, invoice);
            return invoice;
        });
    }
}
