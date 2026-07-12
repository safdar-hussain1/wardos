package com.healthhaven.domain;

import com.healthhaven.validation.Validate;

/** A nurse. Nurses assigned to a critical ward draw a 20% hazard allowance; others draw 8%. */
public final class Nurse extends StaffMember {

    private static final int CRITICAL_WARD_PERCENT = 20;
    private static final int STANDARD_WARD_PERCENT = 8;

    private final String ward;

    public Nurse(Profile profile, String ward) {
        super(profile);
        this.ward = Validate.notBlank(ward, "ward");
    }

    public String ward() {
        return ward;
    }

    public boolean isCriticalWard() {
        String w = ward.toUpperCase();
        return w.contains("ICU") || w.contains("EMERGENCY") || w.contains("CRITICAL");
    }

    @Override
    public StaffRole role() {
        return StaffRole.NURSE;
    }

    @Override
    public Money monthlyPay() {
        return baseSalary().plus(percentOfBase(isCriticalWard() ? CRITICAL_WARD_PERCENT : STANDARD_WARD_PERCENT));
    }

    @Override
    public String allowanceNote() {
        return (isCriticalWard() ? "Critical-ward 20%" : "Ward 8%") + " (" + ward + ")";
    }
}
