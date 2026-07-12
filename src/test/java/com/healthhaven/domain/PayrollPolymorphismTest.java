package com.healthhaven.domain;

import com.healthhaven.service.StaffService;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Proves the point of the staff hierarchy: pay is computed by the object, and a
 * mixed list totals correctly without the caller knowing any concrete type.
 */
class PayrollPolymorphismTest {

    private StaffMember.Profile profile(long baseRupees, int joinYear) {
        return new StaffMember.Profile(0, "EMP-001", "Test Person", Gender.OTHER,
                "+91 90000 00000", "t@healthhaven.example", 1L,
                Money.ofRupees(baseRupees), LocalDate.of(joinYear, 1, 1));
    }

    @Test
    void seniorDoctorGetsSpecialtyAndSeniorityAllowance() {
        Doctor senior = new Doctor(profile(100_000, 2010), "Cardiology");
        // 100k base + 30% specialty + 10% seniority = 140k
        assertThat(senior.isSenior()).isTrue();
        assertThat(senior.monthlyPay()).isEqualTo(Money.ofRupees(140_000));
    }

    @Test
    void juniorDoctorGetsSpecialtyAllowanceOnly() {
        Doctor junior = new Doctor(profile(100_000, LocalDate.now().getYear()), "Cardiology");
        assertThat(junior.isSenior()).isFalse();
        assertThat(junior.monthlyPay()).isEqualTo(Money.ofRupees(130_000));
    }

    @Test
    void criticalWardNurseGetsHazardAllowance() {
        Nurse icu = new Nurse(profile(50_000, 2020), "ICU");
        Nurse ward = new Nurse(profile(50_000, 2020), "General ward");
        assertThat(icu.monthlyPay()).isEqualTo(Money.ofRupees(60_000));   // +20%
        assertThat(ward.monthlyPay()).isEqualTo(Money.ofRupees(54_000));  // +8%
    }

    @Test
    void driverGetsFlatTravelAllowanceNotPercentage() {
        Driver driver = new Driver(profile(30_000, 2019), "DL-1");
        assertThat(driver.monthlyPay()).isEqualTo(Money.ofRupees(33_000));
    }

    @Test
    void payrollSumsAMixedListWithoutKnowingTypes() {
        List<StaffMember> team = List.of(
                new Doctor(profile(100_000, 2010), "Cardiology"),   // 140,000
                new Nurse(profile(50_000, 2020), "ICU"),            //  60,000
                new Technician(profile(40_000, 2018)),              //  44,800 (+12%)
                new Driver(profile(30_000, 2019), "DL-1"),          //  33,000
                new AdminStaff(profile(35_000, 2018)));             //  35,000

        Money total = new StaffService(null).monthlyPayroll(team);

        assertThat(total).isEqualTo(Money.ofRupees(140_000 + 60_000).plus(Money.ofRupees(44_800))
                .plus(Money.ofRupees(33_000)).plus(Money.ofRupees(35_000)));
    }
}
