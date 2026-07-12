package com.healthhaven.db;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;

/**
 * A clock whose "now" can be set, used only for seeding and tests.
 *
 * <p>It lets the demo loader lay down a back-catalogue of stays with realistic,
 * varied lengths — admit at one instant, wind the clock forward some nights,
 * discharge — so the reports and the dashboard have genuine history instead of a
 * pile of same-day stays. Production code is given a {@link Clock#systemUTC()}.
 */
public final class MutableClock extends Clock {

    private volatile Instant now;
    private final ZoneId zone;

    public MutableClock(Instant start) {
        this(start, ZoneId.of("UTC"));
    }

    private MutableClock(Instant start, ZoneId zone) {
        this.now = start;
        this.zone = zone;
    }

    public void set(Instant instant) {
        this.now = instant;
    }

    @Override
    public Instant instant() {
        return now;
    }

    @Override
    public ZoneId getZone() {
        return zone;
    }

    @Override
    public Clock withZone(ZoneId newZone) {
        return new MutableClock(now, newZone);
    }
}
