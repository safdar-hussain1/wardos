package com.healthhaven.domain;

import java.util.Objects;

/**
 * An amount of Indian rupees, held as an integral number of paise.
 *
 * <p>Storing money as text and calling {@code Integer.parseInt} on it at the
 * point of use means a stray space or a decimal point crashes whichever screen
 * happens to be showing it. Money is a value object here: immutable, exact, and
 * impossible to construct from a malformed string without an error.
 */
public final class Money implements Comparable<Money> {

    public static final Money ZERO = new Money(0L);

    private final long paise;

    private Money(long paise) {
        this.paise = paise;
    }

    public static Money ofPaise(long paise) {
        return new Money(paise);
    }

    public static Money ofRupees(long rupees) {
        return new Money(Math.multiplyExact(rupees, 100L));
    }

    /** Parses "1200", "1200.50" or "₹1,200.50". Throws on anything else. */
    public static Money parse(String text) {
        Objects.requireNonNull(text, "amount");
        String cleaned = text.trim().replace("₹", "").replace(",", "").replace("_", "");
        if (cleaned.isEmpty()) {
            throw new IllegalArgumentException("amount is blank");
        }
        boolean negative = cleaned.startsWith("-");
        if (negative || cleaned.startsWith("+")) {
            cleaned = cleaned.substring(1);
        }
        if (!cleaned.matches("\\d+(\\.\\d{1,2})?")) {
            throw new IllegalArgumentException("not a valid amount: " + text);
        }
        int dot = cleaned.indexOf('.');
        long rupees = Long.parseLong(dot < 0 ? cleaned : cleaned.substring(0, dot));
        long fraction = 0;
        if (dot >= 0) {
            String frac = cleaned.substring(dot + 1);
            fraction = Long.parseLong(frac.length() == 1 ? frac + "0" : frac);
        }
        long total = Math.addExact(Math.multiplyExact(rupees, 100L), fraction);
        return new Money(negative ? -total : total);
    }

    public long paise() {
        return paise;
    }

    public Money plus(Money other) {
        return new Money(Math.addExact(paise, other.paise));
    }

    public Money minus(Money other) {
        return new Money(Math.subtractExact(paise, other.paise));
    }

    public Money times(long factor) {
        return new Money(Math.multiplyExact(paise, factor));
    }

    public boolean isNegative() {
        return paise < 0;
    }

    public boolean isZero() {
        return paise == 0;
    }

    /** Formats as "₹12,500.00" using the Indian digit grouping (2,2,3). */
    public String format() {
        long abs = Math.abs(paise);
        String rupees = groupIndian(abs / 100);
        long frac = abs % 100;
        return (paise < 0 ? "-₹" : "₹") + rupees + String.format(".%02d", frac);
    }

    /**
     * A short form for dashboards and stat tiles, where the full figure would be
     * truncated: "₹20.8L", "₹1.2Cr", "₹4,500".
     */
    public String formatCompact() {
        long abs = Math.abs(paise) / 100;
        String sign = paise < 0 ? "-" : "";
        if (abs >= 1_00_00_000L) {
            return sign + "₹" + trim(abs / 1_00_00_000.0) + "Cr";
        }
        if (abs >= 1_00_000L) {
            return sign + "₹" + trim(abs / 1_00_000.0) + "L";
        }
        return sign + "₹" + groupIndian(abs);
    }

    private static String trim(double value) {
        String s = String.format("%.1f", value);
        return s.endsWith(".0") ? s.substring(0, s.length() - 2) : s;
    }

    private static String groupIndian(long value) {
        String s = Long.toString(value);
        if (s.length() <= 3) {
            return s;
        }
        String last3 = s.substring(s.length() - 3);
        String rest = s.substring(0, s.length() - 3);
        StringBuilder out = new StringBuilder();
        while (rest.length() > 2) {
            out.insert(0, "," + rest.substring(rest.length() - 2));
            rest = rest.substring(0, rest.length() - 2);
        }
        return rest + out + "," + last3;
    }

    @Override
    public int compareTo(Money other) {
        return Long.compare(paise, other.paise);
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof Money m && m.paise == paise;
    }

    @Override
    public int hashCode() {
        return Long.hashCode(paise);
    }

    @Override
    public String toString() {
        return format();
    }
}
