package com.healthhaven.domain;

import com.healthhaven.domain.billing.ChargeKind;
import com.healthhaven.domain.billing.ExtraCharge;
import com.healthhaven.domain.billing.Invoice;
import com.healthhaven.service.BillingService;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class AdmissionBillingTest {

    private final BillingService billing = new BillingService();

    @Test
    void billableNightsRoundUpAndAreAtLeastOne() {
        Instant admit = Instant.parse("2026-01-01T23:00:00Z");
        Admission a = new Admission(1, 1, "G-101", 1, "obs", admit, null, Money.ZERO);

        assertThat(a.billableNights(admit.plus(Duration.ofMinutes(30)))).isEqualTo(1);   // same night
        assertThat(a.billableNights(admit.plus(Duration.ofHours(7)))).isEqualTo(1);       // crosses midnight, 1
        assertThat(a.billableNights(admit.plus(Duration.ofHours(25)))).isEqualTo(2);
        assertThat(a.billableNights(admit.plus(Duration.ofDays(3)))).isEqualTo(3);
    }

    @Test
    void invoiceCombinesRoomAndExtrasThenNetsDeposit() {
        Instant admit = Instant.parse("2026-01-01T08:00:00Z");
        Room room = Room.standard("ICU-401", RoomType.ICU, 4);   // ₹9,000/night
        Admission a = new Admission(7, 1, "ICU-401", 1, "critical", admit, null, Money.ofRupees(20_000));

        List<ExtraCharge> extras = List.of(
                new ExtraCharge(1, 7, ChargeKind.PROCEDURE, "Ventilator", 1, Money.ofRupees(15_000), admit),
                new ExtraCharge(2, 7, ChargeKind.PHARMACY, "Drugs", 2, Money.ofRupees(2_500), admit));

        Invoice bill = billing.priceStay(a, room, extras, admit.plus(Duration.ofDays(5)));

        assertThat(bill.nights()).isEqualTo(5);
        assertThat(bill.roomTotal()).isEqualTo(Money.ofRupees(45_000));
        assertThat(bill.extrasTotal()).isEqualTo(Money.ofRupees(15_000 + 5_000));
        assertThat(bill.grossTotal()).isEqualTo(Money.ofRupees(65_000));
        assertThat(bill.balanceDue()).isEqualTo(Money.ofRupees(45_000));   // 65,000 − 20,000 deposit
        assertThat(bill.breakdown().get(ChargeKind.ROOM)).isEqualTo(Money.ofRupees(45_000));
    }
}
