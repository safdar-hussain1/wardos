package com.healthhaven.domain;

import com.healthhaven.validation.Validate;

import java.time.LocalDate;
import java.util.Optional;

/**
 * A member of hospital staff.
 *
 * <p>This is where the original project's OOP was supposed to live and did not.
 * {@code Employee_Info.java} was a {@code JFrame} that ran {@code select * from
 * employee} and dropped the rows into a table; there was no employee type, and
 * pay was a number somebody typed into MySQL by hand.
 *
 * <p>Here the hierarchy earns its keep: {@link #monthlyPay()} is abstract, and
 * each role computes it from its own rules. {@link com.healthhaven.service.StaffService#payroll}
 * sums a {@code List<StaffMember>} without knowing or asking what any of them are.
 */
public abstract sealed class StaffMember extends Person
        permits Doctor, Nurse, Technician, Driver, AdminStaff {

    private final String staffCode;
    private final String email;
    private final Long departmentId;
    private final Money baseSalary;
    private final LocalDate joinedOn;

    protected StaffMember(Profile profile) {
        super(profile.id(), profile.fullName(), profile.gender(), profile.phone());
        this.staffCode = Validate.notBlank(profile.staffCode(), "staff code");
        this.email = Validate.email(profile.email());
        this.departmentId = profile.departmentId();
        this.baseSalary = Validate.positiveMoney(profile.baseSalary(), "base salary");
        this.joinedOn = Validate.pastDate(profile.joinedOn(), "joining date");
    }

    /** Shared staff attributes, so each subclass constructor only names what is special about it. */
    public record Profile(long id,
                          String staffCode,
                          String fullName,
                          Gender gender,
                          String phone,
                          String email,
                          Long departmentId,
                          Money baseSalary,
                          LocalDate joinedOn) {
    }

    public String staffCode() {
        return staffCode;
    }

    public String email() {
        return email;
    }

    public Optional<Long> departmentId() {
        return Optional.ofNullable(departmentId);
    }

    public Money baseSalary() {
        return baseSalary;
    }

    public LocalDate joinedOn() {
        return joinedOn;
    }

    public int yearsOfService(LocalDate asOf) {
        return yearsSince(joinedOn, asOf);
    }

    /** Which kind of staff member this is. Mirrors the {@code staff.role} column. */
    public abstract StaffRole role();

    /**
     * Gross monthly pay for this person: base salary plus whatever their role
     * entitles them to. Each subclass answers for itself.
     */
    public abstract Money monthlyPay();

    /** A one-line summary of the role-specific allowance, for the payslip and the UI. */
    public abstract String allowanceNote();

    @Override
    public String reference() {
        return staffCode;
    }

    @Override
    public String displayName() {
        return role() == StaffRole.DOCTOR ? "Dr. " + fullName() : fullName();
    }

    /** Percentage helper: {@code allowance(20)} is 20% of base salary. */
    protected final Money percentOfBase(int percent) {
        return Money.ofPaise(baseSalary.paise() * percent / 100);
    }
}
