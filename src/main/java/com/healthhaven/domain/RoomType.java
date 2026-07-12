package com.healthhaven.domain;

/**
 * Ward category. The tariff lives with the type rather than being typed into a
 * text box per room, so a "₹250 ICU bed" cannot be entered by accident.
 */
public enum RoomType {
    GENERAL      ("General ward",  Money.ofRupees(1_200), 6),
    SEMI_PRIVATE ("Semi-private",  Money.ofRupees(2_500), 2),
    PRIVATE      ("Private",       Money.ofRupees(4_500), 1),
    ICU          ("Intensive care", Money.ofRupees(9_000), 1);

    private final String label;
    private final Money standardNightlyRate;
    private final int beds;

    RoomType(String label, Money standardNightlyRate, int beds) {
        this.label = label;
        this.standardNightlyRate = standardNightlyRate;
        this.beds = beds;
    }

    public String label() {
        return label;
    }

    public Money standardNightlyRate() {
        return standardNightlyRate;
    }

    public int beds() {
        return beds;
    }
}
