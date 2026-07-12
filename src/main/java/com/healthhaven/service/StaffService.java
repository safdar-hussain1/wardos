package com.healthhaven.service;

import com.healthhaven.domain.Money;
import com.healthhaven.domain.StaffMember;
import com.healthhaven.domain.StaffRole;
import com.healthhaven.repository.StaffRepository;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Staff directory and payroll.
 *
 * <p>{@link #monthlyPayroll} is the clearest payoff of the domain's polymorphism.
 * It folds a {@code List<StaffMember>} into a total by calling {@code
 * monthlyPay()} on each, and never asks what anyone is — a doctor's specialty
 * allowance, a nurse's ward hazard pay, and a driver's flat travel allowance are
 * each computed by the object itself. Adding a new staff type does not touch this
 * method. The original had no staff types and no payroll at all; it printed the
 * {@code employee} table and stopped.
 */
public final class StaffService {

    private final StaffRepository staff;

    public StaffService(StaffRepository staff) {
        this.staff = staff;
    }

    public List<StaffMember> directory() {
        return staff.findAll();
    }

    public Money monthlyPayroll() {
        return staff.findAll().stream()
                .map(StaffMember::monthlyPay)
                .reduce(Money.ZERO, Money::plus);
    }

    public Money monthlyPayroll(List<StaffMember> members) {
        return members.stream().map(StaffMember::monthlyPay).reduce(Money.ZERO, Money::plus);
    }

    public Map<StaffRole, Long> headcountByRole() {
        return staff.findAll().stream()
                .collect(Collectors.groupingBy(StaffMember::role, Collectors.counting()));
    }
}
