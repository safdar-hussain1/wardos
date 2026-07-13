package com.healthhaven.ui;

import com.healthhaven.HealthHaven;
import com.healthhaven.domain.Admission;
import com.healthhaven.domain.Room;

import javax.swing.BorderFactory;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.SwingConstants;
import java.awt.Color;
import java.awt.Dimension;
import java.awt.GridLayout;
import java.time.Instant;
import java.util.Optional;

/**
 * A live grid of every bed, coloured by state — the visual heart of the desktop
 * client. Occupancy comes straight from the admissions table, so a red cell
 * means a real active admission, not a flag somebody forgot to clear.
 */
public final class BedGridPanel extends JPanel {

    private final transient HealthHaven app;

    public BedGridPanel(HealthHaven app) {
        this.app = app;
        setBackground(Color.WHITE);
        setLayout(new GridLayout(0, 6, 8, 8));
        setBorder(BorderFactory.createEmptyBorder(4, 4, 4, 4));
        refresh();
    }

    public void refresh() {
        removeAll();
        for (Room room : app.rooms().findAll()) {
            Optional<Admission> active = app.admissions().findActiveByRoom(room.roomNo());
            add(cell(room, active.orElse(null)));
        }
        revalidate();
        repaint();
    }

    private JPanel cell(Room room, Admission active) {
        Color colour = room.outOfService() ? Theme.OUT : active != null ? Theme.OCCUPIED : Theme.AVAILABLE;
        JPanel cell = new JPanel();
        cell.setLayout(new java.awt.BorderLayout());
        cell.setBackground(colour);
        cell.setPreferredSize(new Dimension(120, 74));
        cell.setBorder(BorderFactory.createEmptyBorder(8, 10, 8, 10));

        JLabel number = new JLabel(room.roomNo());
        number.setForeground(Color.WHITE);
        number.setFont(Theme.H2);
        cell.add(number, java.awt.BorderLayout.NORTH);

        String detail;
        if (room.outOfService()) {
            detail = "out of service";
        } else if (active != null) {
            detail = active.billableNights(Instant.now()) + "n · " + room.type().label();
        } else {
            detail = room.type().label();
        }
        JLabel sub = new JLabel("<html><div style='width:96px'>" + detail + "</div></html>");
        sub.setForeground(new Color(0xFF, 0xFF, 0xFF, 0xDD));
        sub.setFont(Theme.BODY);
        sub.setVerticalAlignment(SwingConstants.BOTTOM);
        cell.add(sub, java.awt.BorderLayout.SOUTH);

        cell.setToolTipText(tooltip(room, active));
        return cell;
    }

    private String tooltip(Room room, Admission active) {
        StringBuilder html = new StringBuilder("<html><b>").append(room.roomNo()).append("</b><br>")
                .append(room.type().label()).append(" · floor ").append(room.floor()).append("<br>")
                .append(room.nightlyRate().format()).append(" per night");
        if (active != null) {
            long nights = active.billableNights(Instant.now());
            html.append("<br><br><b>Occupied</b> — ").append(active.diagnosis())
                    .append("<br>").append(nights).append(nights == 1 ? " night" : " nights")
                    .append(" · room charge ").append(room.nightlyRate().times(nights).format());
        } else if (room.outOfService()) {
            html.append("<br><br>Out of service");
        } else {
            html.append("<br><br>Available");
        }
        return html.append("</html>").toString();
    }
}
