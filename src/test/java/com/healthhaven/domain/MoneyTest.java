package com.healthhaven.domain;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MoneyTest {

    @Test
    void parsesRupeesAndPaise() {
        assertThat(Money.parse("1200").paise()).isEqualTo(120_000);
        assertThat(Money.parse("1200.50").paise()).isEqualTo(120_050);
        assertThat(Money.parse("1200.5").paise()).isEqualTo(120_050);
        assertThat(Money.parse("₹1,200.50").paise()).isEqualTo(120_050);
    }

    @Test
    void rejectsMalformedAmounts() {
        assertThatThrownBy(() -> Money.parse("abc")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> Money.parse("12.345")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> Money.parse("")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void arithmeticIsExact() {
        Money total = Money.ofRupees(4_500).times(4).plus(Money.ofRupees(2_000));
        assertThat(total).isEqualTo(Money.ofRupees(20_000));
        assertThat(Money.ofRupees(1_200).minus(Money.ofRupees(5_000)).isNegative()).isTrue();
    }

    @Test
    void formatsWithIndianGrouping() {
        assertThat(Money.ofRupees(1_200).format()).isEqualTo("₹1,200.00");
        assertThat(Money.ofRupees(12_50_000).format()).isEqualTo("₹12,50,000.00");
        assertThat(Money.ofPaise(-380_000).format()).isEqualTo("-₹3,800.00");
    }
}
