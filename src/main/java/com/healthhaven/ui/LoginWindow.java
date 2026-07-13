package com.healthhaven.ui;

import com.healthhaven.HealthHaven;
import com.healthhaven.domain.User;

import javax.swing.BorderFactory;
import javax.swing.BoxLayout;
import javax.swing.JButton;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JPasswordField;
import javax.swing.JTextField;
import javax.swing.SwingConstants;
import javax.swing.WindowConstants;
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Component;
import java.awt.Dimension;
import java.awt.GridLayout;
import java.util.Optional;

/**
 * The sign-in window.
 *
 * <p>Authentication goes through {@link com.healthhaven.service.AuthService},
 * which looks the account up with a parameterised query and verifies a bcrypt
 * hash — so what is typed into these two fields is a value, never SQL. The
 * seeded demo accounts are printed on the card so the app can be tried
 * immediately; click one to fill the form.
 */
public final class LoginWindow extends JFrame {

    private final transient HealthHaven app;
    private final JTextField username = new JTextField();
    private final JPasswordField password = new JPasswordField();
    private final JLabel message = new JLabel(" ", SwingConstants.CENTER);

    public LoginWindow(HealthHaven app) {
        super("Health Haven");
        this.app = app;
        setDefaultCloseOperation(WindowConstants.EXIT_ON_CLOSE);
        setContentPane(buildContent());
        pack();
        setMinimumSize(new Dimension(420, 480));
        setLocationRelativeTo(null);
        getRootPane().setDefaultButton(signInButton);
    }

    private JButton signInButton;

    private JPanel buildContent() {
        JPanel root = new JPanel(new BorderLayout());
        root.setBackground(Color.WHITE);

        JPanel header = new JPanel();
        header.setLayout(new BoxLayout(header, BoxLayout.Y_AXIS));
        header.setBackground(Theme.TEAL);
        header.setBorder(BorderFactory.createEmptyBorder(36, 32, 36, 32));
        JLabel logo = new JLabel("✚ Health Haven");
        logo.setFont(Theme.H1);
        logo.setForeground(Color.WHITE);
        logo.setAlignmentX(Component.CENTER_ALIGNMENT);
        JLabel tag = new JLabel("Hospital Management System");
        tag.setForeground(new Color(0xD6, 0xEC, 0xEC));
        tag.setAlignmentX(Component.CENTER_ALIGNMENT);
        header.add(logo);
        header.add(tag);
        root.add(header, BorderLayout.NORTH);

        JPanel form = new JPanel();
        form.setLayout(new BoxLayout(form, BoxLayout.Y_AXIS));
        form.setBackground(Color.WHITE);
        form.setBorder(BorderFactory.createEmptyBorder(28, 32, 24, 32));

        form.add(field("Username", username));
        form.add(javax.swing.Box.createVerticalStrut(14));
        form.add(field("Password", password));
        form.add(javax.swing.Box.createVerticalStrut(18));

        signInButton = new JButton("Sign in");
        signInButton.setAlignmentX(Component.CENTER_ALIGNMENT);
        signInButton.setBackground(Theme.TEAL);
        signInButton.setForeground(Color.WHITE);
        signInButton.setMaximumSize(new Dimension(Integer.MAX_VALUE, 40));
        signInButton.addActionListener(e -> attemptLogin());
        form.add(signInButton);

        message.setForeground(Theme.OCCUPIED);
        message.setAlignmentX(Component.CENTER_ALIGNMENT);
        message.setMaximumSize(new Dimension(Integer.MAX_VALUE, 24));
        form.add(javax.swing.Box.createVerticalStrut(8));
        form.add(message);

        root.add(form, BorderLayout.CENTER);
        root.add(demoAccounts(), BorderLayout.SOUTH);
        return root;
    }

    private JPanel field(String label, Component input) {
        JPanel panel = new JPanel(new BorderLayout(0, 4));
        panel.setBackground(Color.WHITE);
        JLabel l = new JLabel(label);
        l.setFont(Theme.BODY);
        l.setForeground(Theme.INK);
        panel.add(l, BorderLayout.NORTH);
        input.setPreferredSize(new Dimension(320, 36));
        panel.add(input, BorderLayout.CENTER);
        return panel;
    }

    private JPanel demoAccounts() {
        JPanel panel = new JPanel(new GridLayout(0, 1));
        panel.setBackground(Theme.MIST);
        panel.setBorder(BorderFactory.createEmptyBorder(14, 32, 18, 32));
        JLabel title = new JLabel("Demo accounts");
        title.setFont(Theme.H2);
        title.setForeground(Theme.INK);
        panel.add(title);
        panel.add(demoRow("admin", "aurora@35", "Administrator"));
        panel.add(demoRow("reception", "changeme-desk", "Receptionist"));
        panel.add(demoRow("dr.iyer", "changeme-doc1", "Doctor"));
        return panel;
    }

    private Component demoRow(String user, String pass, String role) {
        JButton row = new JButton(role + " — " + user + " / " + pass);
        row.setHorizontalAlignment(SwingConstants.LEFT);
        row.setFont(Theme.BODY);
        row.setBorderPainted(false);
        row.setBackground(Theme.MIST);
        row.setForeground(Theme.TEAL_DARK);
        row.addActionListener(e -> {
            username.setText(user);
            password.setText(pass);
            attemptLogin();
        });
        return row;
    }

    private void attemptLogin() {
        Optional<User> user = app.auth().authenticate(username.getText(), password.getPassword());
        if (user.isPresent()) {
            new MainWindow(app, user.get()).setVisible(true);
            dispose();
        } else {
            message.setText("Invalid username or password");
            password.setText("");
        }
    }
}
