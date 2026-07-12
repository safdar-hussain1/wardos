package com.healthhaven.domain;

import com.healthhaven.validation.Validate;

/** A doctor. Draws a specialty allowance of 30% of base, plus 10% once past five years' service. */
public final class Doctor extends StaffMember {

    private static final int SPECIALTY_ALLOWANCE_PERCENT = 30;
    private static final int SENIORITY_ALLOWANCE_PERCENT = 10;
    private static final int SENIORITY_THRESHOLD_YEARS = 5;

    private final String specialty;

    public Doctor(Profile profile, String specialty) {
        super(profile);
        this.specialty = Validate.notBlank(specialty, "specialty");
    }

    public String specialty() {
        return specialty;
    }

    public boolean isSenior() {
        return yearsOfService(java.time.LocalDate.now()) >= SENIORITY_THRESHOLD_YEARS;
    }

    @Override
    public StaffRole role() {
        return StaffRole.DOCTOR;
    }

    @Override
    public Money monthlyPay() {
        Money pay = baseSalary().plus(percentOfBase(SPECIALTY_ALLOWANCE_PERCENT));
        return isSenior() ? pay.plus(percentOfBase(SENIORITY_ALLOWANCE_PERCENT)) : pay;
    }

    @Override
    public String allowanceNote() {
        return isSenior()
                ? "Specialty 30% + seniority 10% (" + specialty + ")"
                : "Specialty 30% (" + specialty + ")";
    }
}
