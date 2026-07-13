package com.healthhaven.ui;

import com.healthhaven.HealthHaven;
import com.healthhaven.domain.Admission;
import com.healthhaven.domain.Ambulance;
import com.healthhaven.domain.Department;
import com.healthhaven.domain.Gender;
import com.healthhaven.domain.Money;
import com.healthhaven.domain.Patient;
import com.healthhaven.domain.Room;
import com.healthhaven.domain.StaffMember;
import com.healthhaven.domain.User;
import com.healthhaven.domain.billing.Invoice;
import com.healthhaven.report.AuditReport;
import com.healthhaven.service.ReportingService;

import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.BoxLayout;
import javax.swing.JButton;
import javax.swing.JComboBox;
import javax.swing.JComponent;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTable;
import javax.swing.JTextArea;
import javax.swing.JTextField;
import javax.swing.SwingConstants;
import javax.swing.WindowConstants;
import javax.swing.border.EmptyBorder;
import java.awt.BorderLayout;
import java.awt.CardLayout;
import java.awt.Color;
import java.awt.Component;
import java.awt.Dimension;
import java.awt.GridLayout;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

/**
 * The main application window: a sidebar of sections and a working panel for
 * each. Admit, discharge, register and dispatch are real actions here — they go
 * through the services and the grid and tables refresh from the database
 * afterwards.
 */
public final class MainWindow extends JFrame {

    private final transient HealthHaven app;
    private final transient User user;
    private final CardLayout cards = new CardLayout();
    private final JPanel content = new JPanel(cards);
    private BedGridPanel bedGrid;

    public MainWindow(HealthHaven app, User user) {
        super("Health Haven — signed in as " + user.fullName());
        this.app = app;
        this.user = user;
        setDefaultCloseOperation(WindowConstants.EXIT_ON_CLOSE);
        setSize(1280, 820);
        setMinimumSize(new Dimension(1040, 680));
        setLocationRelativeTo(null);

        content.setBackground(Color.WHITE);
        content.add(wrap(dashboardPanel()), "Dashboard");
        content.add(wrap(wardsPanel()), "Wards");
        content.add(wrap(patientsPanel()), "Patients");
        content.add(wrap(admissionsPanel()), "Admissions");
        content.add(wrap(staffPanel()), "Staff");
        content.add(wrap(ambulancePanel()), "Ambulances");
        content.add(wrap(auditPanel()), "Audit");

        add(sidebar(), BorderLayout.WEST);
        add(content, BorderLayout.CENTER);
        add(statusBar(), BorderLayout.SOUTH);
    }

    /** Who is signed in and what they may do — the permissions are enforced, so say so. */
    private JComponent statusBar() {
        JPanel bar = new JPanel(new BorderLayout());
        bar.setBackground(Theme.MIST);
        bar.setBorder(BorderFactory.createCompoundBorder(
                BorderFactory.createMatteBorder(1, 0, 0, 0, Theme.LINE),
                new EmptyBorder(7, 14, 7, 14)));

        JLabel who = new JLabel(user.fullName() + "  ·  " + user.role());
        who.setFont(Theme.BODY);
        who.setForeground(Theme.INK);

        JLabel perms = new JLabel(user.role().permissions().size() + " permissions granted");
        perms.setFont(Theme.BODY);
        perms.setForeground(new Color(0x6B, 0x7A, 0x84));

        bar.add(who, BorderLayout.WEST);
        bar.add(perms, BorderLayout.EAST);
        return bar;
    }

    // -- navigation -----------------------------------------------------------

    private JComponent sidebar() {
        JPanel bar = new JPanel();
        bar.setLayout(new BoxLayout(bar, BoxLayout.Y_AXIS));
        bar.setBackground(Theme.INK);
        bar.setPreferredSize(new Dimension(210, 0));
        bar.setBorder(new EmptyBorder(20, 0, 20, 0));

        JLabel logo = new JLabel("  ✚ Health Haven");
        logo.setForeground(Color.WHITE);
        logo.setFont(Theme.H2);
        logo.setBorder(new EmptyBorder(0, 12, 20, 12));
        logo.setAlignmentX(Component.LEFT_ALIGNMENT);
        bar.add(logo);

        for (String name : new String[]{"Dashboard", "Wards", "Patients", "Admissions", "Staff", "Ambulances", "Audit"}) {
            bar.add(navButton(name));
        }
        bar.add(Box.createVerticalGlue());

        JButton signOut = navButton("Sign out");
        signOut.addActionListener(e -> {
            new LoginWindow(app).setVisible(true);
            dispose();
        });
        bar.add(signOut);
        return bar;
    }

    private JButton navButton(String name) {
        JButton button = new JButton(name);
        button.setAlignmentX(Component.LEFT_ALIGNMENT);
        button.setMaximumSize(new Dimension(Integer.MAX_VALUE, 44));
        button.setHorizontalAlignment(SwingConstants.LEFT);
        button.setBorder(new EmptyBorder(8, 18, 8, 18));
        button.setBackground(Theme.INK);
        button.setForeground(new Color(0xCF, 0xDA, 0xE1));
        button.setFocusPainted(false);
        button.setBorderPainted(false);
        button.addActionListener(e -> {
            if (name.equals("Wards") && bedGrid != null) {
                bedGrid.refresh();
            }
            cards.show(content, name);
        });
        return button;
    }

    private JComponent wrap(JComponent panel) {
        panel.setBorder(new EmptyBorder(22, 26, 22, 26));
        panel.setBackground(Color.WHITE);
        return panel;
    }

    private JLabel pageTitle(String text) {
        JLabel title = new JLabel(text);
        title.setFont(Theme.H1);
        title.setForeground(Theme.INK);
        title.setBorder(new EmptyBorder(0, 0, 16, 0));
        return title;
    }

    // -- dashboard ------------------------------------------------------------

    private JPanel dashboardPanel() {
        JPanel panel = new JPanel(new BorderLayout(0, 16));
        panel.setBackground(Color.WHITE);
        panel.add(pageTitle("Dashboard"), BorderLayout.NORTH);

        ReportingService r = app.reporting();
        ReportingService.Occupancy occ = r.occupancy();
        // Compact figures here: the full "₹20,78,200.00" does not fit a stat tile
        // and silently truncates to "₹20,78,20…", which is worse than rounding.
        JPanel kpis = UiSupport.kpiRow(
                UiSupport.kpiCard("Patients", String.valueOf(app.patients().count()), Theme.TEAL),
                UiSupport.kpiCard("Admitted now", String.valueOf(r.activeAdmissionCount()), Theme.TEAL),
                UiSupport.kpiCard("Occupancy", Math.round(occ.occupancyRate() * 100) + "%", Theme.OCCUPIED),
                UiSupport.kpiCard("Mean stay", String.format("%.1fn", r.meanCompletedStayNights()), Theme.INK),
                UiSupport.kpiCard("Billed", r.totalBilled().formatCompact(), Theme.INK),
                UiSupport.kpiCard("Payroll / mo", app.staffService().monthlyPayroll().formatCompact(), Theme.INK));

        JPanel body = new JPanel(new GridLayout(1, 3, 16, 0));
        body.setBackground(Color.WHITE);

        List<Object[]> deptRows = new ArrayList<>();
        r.activeLoadByDepartment().forEach((dept, n) -> deptRows.add(new Object[]{dept, n}));
        body.add(titled("Active admissions by department",
                card(UiSupport.readOnlyTable(new String[]{"Department", "Admitted"}, deptRows))));

        List<Object[]> wardRows = new ArrayList<>();
        occ.byType().forEach((type, t) -> wardRows.add(
                new Object[]{type.label(), t.occupied() + " / " + t.total(), t.available()}));
        body.add(titled("Beds by ward type",
                card(UiSupport.readOnlyTable(new String[]{"Ward", "Occupied", "Free"}, wardRows))));

        List<Object[]> mixRows = new ArrayList<>();
        r.revenueMix().forEach((kind, money) -> mixRows.add(new Object[]{kind.label(), money.format()}));
        body.add(titled("Revenue by charge type",
                card(UiSupport.readOnlyTable(new String[]{"Charge type", "Total"}, mixRows))));

        JPanel centre = new JPanel(new BorderLayout(0, 16));
        centre.setBackground(Color.WHITE);
        centre.add(kpis, BorderLayout.NORTH);
        centre.add(body, BorderLayout.CENTER);
        panel.add(centre, BorderLayout.CENTER);
        return panel;
    }

    /** A hairline-bordered container, so a short table reads as a card rather than as floating text. */
    private JComponent card(JComponent body) {
        JScrollPane pane = new JScrollPane(body);
        pane.setBorder(BorderFactory.createLineBorder(Theme.LINE));
        pane.getViewport().setBackground(Color.WHITE);
        return pane;
    }

    private JPanel titled(String title, JComponent body) {
        JPanel panel = new JPanel(new BorderLayout(0, 8));
        panel.setBackground(Color.WHITE);
        panel.add(UiSupport.heading(title), BorderLayout.NORTH);
        panel.add(body, BorderLayout.CENTER);
        return panel;
    }

    // -- wards ----------------------------------------------------------------

    private JPanel wardsPanel() {
        JPanel panel = new JPanel(new BorderLayout(0, 12));
        panel.setBackground(Color.WHITE);
        panel.add(pageTitle("Wards"), BorderLayout.NORTH);

        JPanel legend = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.LEFT, 16, 0));
        legend.setBackground(Color.WHITE);
        legend.add(legendDot("Available", Theme.AVAILABLE));
        legend.add(legendDot("Occupied", Theme.OCCUPIED));
        legend.add(legendDot("Out of service", Theme.OUT));

        bedGrid = new BedGridPanel(app);
        JPanel south = new JPanel(new BorderLayout());
        south.setBackground(Color.WHITE);
        south.add(legend, BorderLayout.WEST);

        JPanel centre = new JPanel(new BorderLayout(0, 12));
        centre.setBackground(Color.WHITE);
        centre.add(south, BorderLayout.NORTH);
        centre.add(UiSupport.scroll(bedGrid), BorderLayout.CENTER);
        panel.add(centre, BorderLayout.CENTER);
        return panel;
    }

    private JComponent legendDot(String label, Color colour) {
        JPanel dot = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.LEFT, 6, 0));
        dot.setBackground(Color.WHITE);
        JLabel swatch = new JLabel("  ");
        swatch.setOpaque(true);
        swatch.setBackground(colour);
        swatch.setPreferredSize(new Dimension(16, 16));
        dot.add(swatch);
        dot.add(new JLabel(label));
        return dot;
    }

    // -- patients -------------------------------------------------------------

    private JPanel patientsPanel() {
        JPanel panel = new JPanel(new BorderLayout(0, 12));
        panel.setBackground(Color.WHITE);
        panel.add(pageTitle("Patients"), BorderLayout.NORTH);

        JTextField search = new JTextField(18);
        JButton searchBtn = new JButton("Search");
        JButton registerBtn = new JButton("Register patient");
        JScrollPane tableHolder = new JScrollPane();
        tableHolder.setBorder(BorderFactory.createLineBorder(Theme.LINE));

        Runnable reload = () -> {
            List<Object[]> rows = new ArrayList<>();
            for (Patient p : app.patientService().search(search.getText())) {
                rows.add(new Object[]{p.mrn(), p.fullName(), p.age(), p.gender(), p.maskedId(), p.phone()});
            }
            JTable table = UiSupport.readOnlyTable(
                    new String[]{"MRN", "Name", "Age", "Gender", "ID", "Phone"}, rows);
            tableHolder.setViewportView(table);
        };
        searchBtn.addActionListener(e -> reload.run());
        search.addActionListener(e -> reload.run());
        registerBtn.addActionListener(e -> {
            if (registerPatientDialog()) {
                reload.run();
            }
        });

        JPanel centre = new JPanel(new BorderLayout());
        centre.setBackground(Color.WHITE);
        centre.add(UiSupport.toolbar(new JLabel("Find:"), search, searchBtn, Box.createHorizontalStrut(16), registerBtn),
                BorderLayout.NORTH);
        centre.add(tableHolder, BorderLayout.CENTER);
        panel.add(centre, BorderLayout.CENTER);
        reload.run();
        return panel;
    }

    private boolean registerPatientDialog() {
        JTextField name = new JTextField();
        JComboBox<Gender> gender = new JComboBox<>(Gender.values());
        JTextField dob = new JTextField("1990-01-01");
        JTextField phone = new JTextField("+91 90000 00000");
        JComboBox<Patient.IdKind> idKind = new JComboBox<>(Patient.IdKind.values());
        JTextField idLast4 = new JTextField();

        JPanel form = new JPanel(new GridLayout(0, 2, 8, 8));
        form.add(new JLabel("Full name")); form.add(name);
        form.add(new JLabel("Gender")); form.add(gender);
        form.add(new JLabel("Date of birth (YYYY-MM-DD)")); form.add(dob);
        form.add(new JLabel("Phone")); form.add(phone);
        form.add(new JLabel("ID type")); form.add(idKind);
        form.add(new JLabel("ID last 4 digits")); form.add(idLast4);

        int choice = JOptionPane.showConfirmDialog(this, form, "Register patient",
                JOptionPane.OK_CANCEL_OPTION, JOptionPane.PLAIN_MESSAGE);
        if (choice != JOptionPane.OK_OPTION) {
            return false;
        }
        try {
            app.auth().require(user, com.healthhaven.domain.Permission.REGISTER_PATIENT);
            Patient p = app.patientService().register(name.getText(), (Gender) gender.getSelectedItem(),
                    LocalDate.parse(dob.getText().trim()), phone.getText(),
                    (Patient.IdKind) idKind.getSelectedItem(), idLast4.getText().trim());
            JOptionPane.showMessageDialog(this, "Registered " + p.displayName());
            return true;
        } catch (Exception ex) {
            error(ex);
            return false;
        }
    }

    // -- admissions -----------------------------------------------------------

    private JPanel admissionsPanel() {
        JPanel panel = new JPanel(new BorderLayout(0, 12));
        panel.setBackground(Color.WHITE);
        panel.add(pageTitle("Admissions"), BorderLayout.NORTH);

        JScrollPane holder = new JScrollPane();
        holder.setBorder(BorderFactory.createLineBorder(Theme.LINE));
        AtomicReference<JTable> tableRef = new AtomicReference<>();
        AtomicReference<List<Admission>> dataRef = new AtomicReference<>(List.of());

        Runnable reload = () -> {
            List<Admission> active = app.admissions().findActive();
            dataRef.set(active);
            List<Object[]> rows = new ArrayList<>();
            for (Admission a : active) {
                Patient p = app.patients().findById(a.patientId()).orElseThrow();
                rows.add(new Object[]{a.id(), p.fullName(), a.roomNo(),
                        a.billableNights(Instant.now()), a.diagnosis(), a.deposit().format()});
            }
            JTable table = UiSupport.readOnlyTable(
                    new String[]{"Adm#", "Patient", "Room", "Nights", "Diagnosis", "Deposit"}, rows);
            tableRef.set(table);
            holder.setViewportView(table);
            if (bedGrid != null) {
                bedGrid.refresh();
            }
        };

        JButton admitBtn = new JButton("Admit patient");
        admitBtn.addActionListener(e -> {
            if (admitDialog()) {
                reload.run();
            }
        });
        JButton quoteBtn = new JButton("Preview bill");
        quoteBtn.addActionListener(e -> withSelectedAdmission(tableRef.get(), dataRef.get(), a ->
                showInvoice("Current bill", app.admissionService().quote(a))));
        JButton dischargeBtn = new JButton("Discharge & bill");
        dischargeBtn.addActionListener(e -> withSelectedAdmission(tableRef.get(), dataRef.get(), a -> {
            try {
                app.auth().require(user, com.healthhaven.domain.Permission.DISCHARGE_PATIENT);
                Invoice invoice = app.admissionService().discharge(a);
                showInvoice("Discharge invoice", invoice);
                reload.run();
            } catch (Exception ex) {
                error(ex);
            }
        }));

        JPanel centre = new JPanel(new BorderLayout());
        centre.setBackground(Color.WHITE);
        centre.add(UiSupport.toolbar(admitBtn, quoteBtn, dischargeBtn), BorderLayout.NORTH);
        centre.add(holder, BorderLayout.CENTER);
        panel.add(centre, BorderLayout.CENTER);
        reload.run();
        return panel;
    }

    private void withSelectedAdmission(JTable table, List<Admission> data, java.util.function.Consumer<Admission> action) {
        int row = table == null ? -1 : table.getSelectedRow();
        if (row < 0 || row >= data.size()) {
            JOptionPane.showMessageDialog(this, "Select an admission first.");
            return;
        }
        action.accept(data.get(row));
    }

    private boolean admitDialog() {
        List<Patient> notAdmitted = new ArrayList<>();
        for (Patient p : app.patients().findAll()) {
            if (app.admissions().findActiveByPatient(p.id()).isEmpty()) {
                notAdmitted.add(p);
            }
        }
        List<Room> free = app.rooms().findAvailable();
        if (notAdmitted.isEmpty() || free.isEmpty()) {
            JOptionPane.showMessageDialog(this, "Need at least one un-admitted patient and one free room.");
            return false;
        }
        JComboBox<Patient> patient = new JComboBox<>(notAdmitted.toArray(new Patient[0]));
        JComboBox<Room> room = new JComboBox<>(free.toArray(new Room[0]));
        JComboBox<Department> dept = new JComboBox<>(app.departments().findAll().toArray(new Department[0]));
        JTextField diagnosis = new JTextField("Observation");
        JTextField deposit = new JTextField("5000");

        JPanel form = new JPanel(new GridLayout(0, 2, 8, 8));
        form.add(new JLabel("Patient")); form.add(patient);
        form.add(new JLabel("Room")); form.add(room);
        form.add(new JLabel("Department")); form.add(dept);
        form.add(new JLabel("Diagnosis")); form.add(diagnosis);
        form.add(new JLabel("Deposit (₹)")); form.add(deposit);

        int choice = JOptionPane.showConfirmDialog(this, form, "Admit patient",
                JOptionPane.OK_CANCEL_OPTION, JOptionPane.PLAIN_MESSAGE);
        if (choice != JOptionPane.OK_OPTION) {
            return false;
        }
        try {
            app.auth().require(user, com.healthhaven.domain.Permission.ADMIT_PATIENT);
            app.admissionService().admit((Patient) patient.getSelectedItem(),
                    ((Room) room.getSelectedItem()).roomNo(),
                    ((Department) dept.getSelectedItem()).id(),
                    diagnosis.getText(), Money.parse(deposit.getText()));
            return true;
        } catch (Exception ex) {
            error(ex);
            return false;
        }
    }

    private void showInvoice(String title, Invoice invoice) {
        JTextArea area = new JTextArea(invoice.render());
        area.setFont(Theme.MONO);
        area.setEditable(false);
        area.setBackground(Theme.MIST);
        JScrollPane pane = new JScrollPane(area);
        pane.setPreferredSize(new Dimension(560, 360));
        JOptionPane.showMessageDialog(this, pane, title, JOptionPane.PLAIN_MESSAGE);
    }

    // -- staff ----------------------------------------------------------------

    private JPanel staffPanel() {
        JPanel panel = new JPanel(new BorderLayout(0, 12));
        panel.setBackground(Color.WHITE);
        panel.add(pageTitle("Staff & payroll"), BorderLayout.NORTH);

        List<Object[]> rows = new ArrayList<>();
        for (StaffMember s : app.staffService().directory()) {
            rows.add(new Object[]{s.staffCode(), s.displayName(), s.role().label(),
                    s.monthlyPay().format(), s.allowanceNote()});
        }
        JTable table = UiSupport.readOnlyTable(
                new String[]{"Code", "Name", "Role", "Monthly pay", "Allowance"}, rows);
        JScrollPane holder = new JScrollPane(table);
        holder.setBorder(BorderFactory.createLineBorder(Theme.LINE));

        JLabel total = new JLabel("Total monthly payroll:  " + app.staffService().monthlyPayroll().format());
        total.setFont(Theme.H2);
        total.setForeground(Theme.TEAL_DARK);
        total.setBorder(new EmptyBorder(10, 2, 0, 0));

        panel.add(holder, BorderLayout.CENTER);
        panel.add(total, BorderLayout.SOUTH);
        return panel;
    }

    // -- ambulances -----------------------------------------------------------

    private JPanel ambulancePanel() {
        JPanel panel = new JPanel(new BorderLayout(0, 12));
        panel.setBackground(Color.WHITE);
        panel.add(pageTitle("Ambulance fleet"), BorderLayout.NORTH);

        JScrollPane holder = new JScrollPane();
        holder.setBorder(BorderFactory.createLineBorder(Theme.LINE));
        AtomicReference<JTable> tableRef = new AtomicReference<>();
        AtomicReference<List<Ambulance>> dataRef = new AtomicReference<>(List.of());

        Runnable reload = () -> {
            List<Ambulance> fleet = app.ambulanceService().fleet();
            dataRef.set(fleet);
            List<Object[]> rows = new ArrayList<>();
            for (Ambulance a : fleet) {
                rows.add(new Object[]{a.vehicleNo(), a.driverName(), a.status(), a.baseLocation()});
            }
            JTable table = UiSupport.readOnlyTable(
                    new String[]{"Vehicle", "Driver", "Status", "Base"}, rows);
            tableRef.set(table);
            holder.setViewportView(table);
        };

        JButton dispatch = new JButton("Dispatch");
        dispatch.addActionListener(e -> withSelectedAmbulance(tableRef.get(), dataRef.get(), a -> {
            String dest = JOptionPane.showInputDialog(this, "Destination for " + a.vehicleNo() + ":");
            if (dest != null && !dest.isBlank()) {
                try {
                    app.ambulanceService().dispatch(a.id(), dest.trim());
                    reload.run();
                } catch (Exception ex) {
                    error(ex);
                }
            }
        }));
        JButton recall = new JButton("Recall");
        recall.addActionListener(e -> withSelectedAmbulance(tableRef.get(), dataRef.get(), a -> {
            try {
                app.ambulanceService().recall(a.id());
                reload.run();
            } catch (Exception ex) {
                error(ex);
            }
        }));

        JPanel centre = new JPanel(new BorderLayout());
        centre.setBackground(Color.WHITE);
        centre.add(UiSupport.toolbar(dispatch, recall), BorderLayout.NORTH);
        centre.add(holder, BorderLayout.CENTER);
        panel.add(centre, BorderLayout.CENTER);
        reload.run();
        return panel;
    }

    private void withSelectedAmbulance(JTable table, List<Ambulance> data, java.util.function.Consumer<Ambulance> action) {
        int row = table == null ? -1 : table.getSelectedRow();
        if (row < 0 || row >= data.size()) {
            JOptionPane.showMessageDialog(this, "Select an ambulance first.");
            return;
        }
        action.accept(data.get(row));
    }

    // -- audit ----------------------------------------------------------------

    private JPanel auditPanel() {
        JPanel panel = new JPanel(new BorderLayout(0, 12));
        panel.setBackground(Color.WHITE);
        panel.add(pageTitle("Correctness — the naive approach vs Health Haven"), BorderLayout.NORTH);

        JTextArea area = new JTextArea();
        area.setFont(Theme.MONO);
        area.setEditable(false);
        StringBuilder sb = new StringBuilder();
        for (AuditReport.Finding f : new AuditReport().run()) {
            sb.append('[').append(f.id()).append("]  ").append(f.title()).append('\n');
            sb.append("   naive        : ").append(f.naiveResult()).append('\n');
            sb.append("   health haven : ").append(f.healthHavenResult()).append('\n');
            sb.append("   impact   : ").append(f.impact()).append("\n\n");
        }
        area.setText(sb.toString());
        area.setCaretPosition(0);
        JScrollPane holder = new JScrollPane(area);
        holder.setBorder(BorderFactory.createLineBorder(Theme.LINE));
        panel.add(holder, BorderLayout.CENTER);
        return panel;
    }

    private void error(Exception ex) {
        JOptionPane.showMessageDialog(this, ex.getMessage(), "Could not complete", JOptionPane.WARNING_MESSAGE);
    }
}
