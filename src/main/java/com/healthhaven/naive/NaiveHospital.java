package com.healthhaven.naive;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;

/**
 * The obvious implementation of a hospital system — the one that looks right,
 * compiles, runs, and is wrong in four expensive ways.
 *
 * <p>This class exists so those four ways can be <em>demonstrated</em> rather
 * than asserted. Health Haven makes a series of design choices that cost more
 * effort than the straightforward alternative: parameterised SQL instead of
 * string concatenation, an invoice that knows about length of stay, discharge as
 * an archive rather than a delete, and occupancy derived from admissions rather
 * than stored as a flag. Every one of those is easy to wave away as
 * over-engineering until you watch what happens without it.
 *
 * <p>So this is what happens without it. Each method here is the shortest, most
 * natural version of an operation the real system does properly:
 *
 * <ol>
 *   <li>{@link #login} builds its query by concatenation, so a crafted password
 *       signs in as anybody;</li>
 *   <li>{@link #pendingAmount} charges {@code rate − deposit}, where the rate is
 *       for a single night and the length of stay never enters the sum;</li>
 *   <li>{@link #discharge} deletes the patient row, so the hospital forgets
 *       everyone it discharges;</li>
 *   <li>{@link #admit} writes its two statements without a transaction, and
 *       nothing stops a second patient going into an occupied bed.</li>
 * </ol>
 *
 * <p>It is never wired into the application. Only {@code report.AuditReport} and
 * the comparison tests touch it. Run {@code java -jar health-haven.jar audit} to
 * see both approaches side by side.
 */
public final class NaiveHospital {

    private final Connection connection;

    public NaiveHospital(Connection connection) {
        this.connection = connection;
        createTables();
    }

    /** The tables this approach reaches for: flat, denormalised, occupancy as a word in a column. */
    private void createTables() {
        try (Statement s = connection.createStatement()) {
            s.execute("CREATE TABLE IF NOT EXISTS login (ID TEXT, PW TEXT)");
            s.execute("""
                    CREATE TABLE IF NOT EXISTS patient_info (
                        idcard TEXT, number TEXT, name TEXT, gender TEXT,
                        disease TEXT, room_number TEXT, time TEXT, deposit TEXT)
                    """);
            s.execute("CREATE TABLE IF NOT EXISTS room (room_no TEXT, availability TEXT, price TEXT, bed_type TEXT)");
        } catch (SQLException e) {
            throw new IllegalStateException("could not create the comparison tables", e);
        }
    }

    /** Passwords go in as they were typed. Nothing hashes them. */
    public void addUser(String id, String plainPassword) {
        exec("INSERT INTO login VALUES ('" + id + "', '" + plainPassword + "')");
    }

    public void addRoom(String roomNo, String price) {
        exec("INSERT INTO room VALUES ('" + roomNo + "', 'Available', '" + price + "', 'General')");
    }

    /**
     * Authentication as a lookup:
     *
     * <pre>
     * String q = "select * from login where ID = '" + user + "' and PW = '" + pass + "'";
     * if (statement.executeQuery(q).next()) { // signed in }
     * </pre>
     *
     * <p>The password is pasted into the query unescaped, so it is not a value —
     * it is code. A password of {@code ' OR '1'='1} closes the string and appends
     * a tautology, and the {@code WHERE} clause then matches every row in the
     * table. Health Haven binds parameters and verifies a bcrypt hash.
     */
    public boolean login(String user, String pass) {
        String q = "select * from login where ID = '" + user + "' and PW = '" + pass + "'";
        try (Statement s = connection.createStatement(); ResultSet rs = s.executeQuery(q)) {
            return rs.next();
        } catch (SQLException e) {
            return false;
        }
    }

    /**
     * Admission as two statements: record the patient, then mark the room taken.
     *
     * <p>There is no transaction, so if the second fails the first still stands —
     * a patient in a bed the system believes is empty. And nothing anywhere checks
     * whether the room was already occupied, because occupancy is just a word in a
     * column. Health Haven does both in one transaction, against a partial unique
     * index that makes the second admission impossible.
     */
    public void admit(String idcard, String number, String name, String gender,
                      String disease, String roomNo, String time, String deposit) {
        exec("INSERT INTO patient_info VALUES ('" + idcard + "', '" + number + "', '" + name + "', '"
                + gender + "', '" + disease + "', '" + roomNo + "', '" + time + "', '" + deposit + "')");
        exec("UPDATE room SET availability = 'Occupied' WHERE room_no = '" + roomNo + "'");
    }

    /**
     * The bill:
     *
     * <pre>
     * int pending = Integer.parseInt(price) - Integer.parseInt(deposit);
     * </pre>
     *
     * <p>This is the expensive one, and it is expensive precisely because it looks
     * fine. It compiles, it runs, it produces a number, and a number appears in the
     * box labelled "amount due". But {@code price} is the tariff for <em>one
     * night</em>, and the length of the stay appears nowhere in the expression — so
     * a patient who stayed one night and a patient who stayed three weeks in the
     * same bed are charged exactly the same. Any deposit larger than a single
     * night's rate also makes the result negative, which the screen will happily
     * present as the amount owed.
     *
     * <p>Room and board is roughly three-quarters of a hospital's billings, so this
     * one line gives away most of the revenue. Health Haven prices a stay as
     * {@code nights × rate + extras − deposit}, and reports an over-deposit as a
     * refund.
     */
    public int pendingAmount(String roomNo, String depositEntered) {
        String price = queryString("SELECT price FROM room WHERE room_no = '" + roomNo + "'");
        return Integer.parseInt(price) - Integer.parseInt(depositEntered);
    }

    /**
     * Discharge as a delete:
     *
     * <pre>
     * statement.executeUpdate("delete from patient_info where number = '" + id + "'");
     * </pre>
     *
     * <p>The stay is over, so the row goes. With it goes the patient: their history,
     * their diagnoses, the fact that they were ever here at all. A returning patient
     * is a stranger. Health Haven closes the admission, issues an invoice, and keeps
     * the person forever.
     */
    public void discharge(String number, String roomNo) {
        exec("DELETE FROM patient_info WHERE number = '" + number + "'");
        exec("UPDATE room SET availability = 'Available' WHERE room_no = '" + roomNo + "'");
    }

    public int patientCount() {
        return Integer.parseInt(queryString("SELECT COUNT(*) FROM patient_info"));
    }

    public String roomAvailability(String roomNo) {
        return queryString("SELECT availability FROM room WHERE room_no = '" + roomNo + "'");
    }

    private void exec(String sql) {
        try (Statement s = connection.createStatement()) {
            s.executeUpdate(sql);
        } catch (SQLException e) {
            throw new IllegalStateException("statement failed: " + sql, e);
        }
    }

    private String queryString(String sql) {
        try (Statement s = connection.createStatement(); ResultSet rs = s.executeQuery(sql)) {
            return rs.next() ? rs.getString(1) : null;
        } catch (SQLException e) {
            throw new IllegalStateException("query failed: " + sql, e);
        }
    }
}
