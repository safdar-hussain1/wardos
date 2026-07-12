package com.healthhaven.domain;

/** Lab and imaging technician. Draws a flat 12% equipment allowance. */
public final class Technician extends StaffMember {

    private static final int EQUIPMENT_ALLOWANCE_PERCENT = 12;

    public Technician(Profile profile) {
        super(profile);
    }

    @Override
    public StaffRole role() {
        return StaffRole.TECHNICIAN;
    }

    @Override
    public Money monthlyPay() {
        return baseSalary().plus(percentOfBase(EQUIPMENT_ALLOWANCE_PERCENT));
    }

    @Override
    public String allowanceNote() {
        return "Equipment 12%";
    }
}
