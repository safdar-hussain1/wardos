package com.healthhaven.domain;

import com.healthhaven.validation.Validate;

/** Ambulance driver. Draws a flat travel allowance rather than a percentage of base. */
public final class Driver extends StaffMember {

    private static final Money TRAVEL_ALLOWANCE = Money.ofRupees(3_000);

    private final String licenceNo;

    public Driver(Profile profile, String licenceNo) {
        super(profile);
        this.licenceNo = Validate.notBlank(licenceNo, "licence number");
    }

    public String licenceNo() {
        return licenceNo;
    }

    @Override
    public StaffRole role() {
        return StaffRole.DRIVER;
    }

    @Override
    public Money monthlyPay() {
        return baseSalary().plus(TRAVEL_ALLOWANCE);
    }

    @Override
    public String allowanceNote() {
        return "Travel " + TRAVEL_ALLOWANCE.format() + " flat";
    }
}
