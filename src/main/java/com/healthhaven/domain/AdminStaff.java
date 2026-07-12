package com.healthhaven.domain;

/** Reception, records and back-office staff. No role allowance. */
public final class AdminStaff extends StaffMember {

    public AdminStaff(Profile profile) {
        super(profile);
    }

    @Override
    public StaffRole role() {
        return StaffRole.ADMIN_STAFF;
    }

    @Override
    public Money monthlyPay() {
        return baseSalary();
    }

    @Override
    public String allowanceNote() {
        return "None";
    }
}
