package com.healthhaven.legacy;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;

/**
 * A faithful, minimal reproduction of how the original 2024 course project
 * worked — the parts that were wrong, kept wrong on purpose.
 *
 * <p>This is not the original code (that was ~1,450 lines of Swing spread over
 * twelve {@code JFrame} subclasses). It is the exact <em>logic</em> of the three
 * behaviours the audit is about, extracted so the tests can run them and show
 * what they did:
 *
 * <ol>
 *   <li>login by string-concatenated SQL, so a crafted password logs in;</li>
 *   <li>the "pending amount" computed as one night's room rate minus the
 *       deposit, with length of stay absent;</li>
 *   <li>discharge as {@code DELETE FROM patient_info}, which erases the record.</li>
 * </ol>
 *
 * <p>It runs against SQLite rather than the original's MySQL — the bug is in the
 * string handling and the arithmetic, not the database, and both reproduce
 * identically. Every method here mirrors a real block in the original; the file
 * it came from is named in each Javadoc.
 */
public final class LegacyHospital {

    private final Connection connection;

    public LegacyHospital(Connection connection) {
        this.connection = connection;
        createLegacyTables();
    }

    /** The original's MySQL tables, trimmed to the columns these behaviours touch. */
    private void createLegacyTables() {
        try (Statement s = connection.createStatement()) {
            s.execute("CREATE TABLE IF NOT EXISTS login (ID TEXT, PW TEXT)");
            s.execute("""
                    CREATE TABLE IF NOT EXISTS patient_info (
                        idcard TEXT, number TEXT, name TEXT, gender TEXT,
                        disease TEXT, room_number TEXT, time TEXT, deposit TEXT)
                    """);
            s.execute("CREATE TABLE IF NOT EXISTS room (room_no TEXT, availability TEXT, price TEXT, bed_type TEXT)");
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    public void addUser(String id, String plainPassword) {
        exec("INSERT INTO login VALUES ('" + id + "', '" + plainPassword + "')");
    }

    public void addRoom(String roomNo, String price) {
        exec("INSERT INTO room VALUES ('" + roomNo + "', 'Available', '" + price + "', 'General')");
    }

    /**
     * Login exactly as {@code Login.actionPerformed} built it:
     * <pre>
     * String q = "select * from login where ID = '" + user + "' and PW = '" + pass + "'";
     * ResultSet rs = c.statement.executeQuery(q);
     * if (rs.next()) { // logged in }
     * </pre>
     * The password is concatenated straight into the query, unescaped.
     */
    public boolean login(String user, String pass) {
        String q = "select * from login where ID = '" + user + "' and PW = '" + pass + "'";
        try (Statement s = connection.createStatement(); ResultSet rs = s.executeQuery(q)) {
            return rs.next();
        } catch (SQLException e) {
            // The original swallowed this with e.printStackTrace() and carried on.
            return false;
        }
    }

    /**
     * Registers a patient, then marks the room occupied — as two separate
     * auto-committed statements, the way {@code AddNewPatient.addPatient} did.
     * There is no transaction: if the second fails, the first still stands.
     */
    public void admit(String idcard, String number, String name, String gender,
                      String disease, String roomNo, String time, String deposit) {
        exec("INSERT INTO patient_info VALUES ('" + idcard + "', '" + number + "', '" + name + "', '"
                + gender + "', '" + disease + "', '" + roomNo + "', '" + time + "', '" + deposit + "')");
        exec("UPDATE room SET availability = 'Occupied' WHERE room_no = '" + roomNo + "'");
    }

    /**
     * The billing calculation from {@code Update_Patient_Details.actionPerformed}:
     * <pre>
     * int amountPaid = Integer.parseInt(price) - Integer.parseInt(textFieldAmount.getText());
     * textFieldPending.setText("" + amountPaid);
     * </pre>
     * {@code price} is the room's <em>nightly</em> rate; the deposit is
     * subtracted from it directly. Length of stay never enters the sum, and the
     * result is shown as the "Pending Amount (Rs)" regardless of sign.
     */
    public int pendingAmount(String roomNo, String depositEntered) {
        String price = queryString("SELECT price FROM room WHERE room_no = '" + roomNo + "'");
        return Integer.parseInt(price) - Integer.parseInt(depositEntered);
    }

    /**
     * Discharge as {@code Patient_Discharge.actionPerformed} performed it:
     * <pre>
     * c.statement.executeUpdate("delete from Patient_Info where number = '" + id + "'");
     * </pre>
     * The patient row is deleted. Nothing about the stay survives.
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
            throw new RuntimeException(e);
        }
    }

    private String queryString(String sql) {
        try (Statement s = connection.createStatement(); ResultSet rs = s.executeQuery(sql)) {
            return rs.next() ? rs.getString(1) : null;
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }
}
