package com.healthhaven.ui;

import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTable;
import javax.swing.ListSelectionModel;
import javax.swing.border.EmptyBorder;
import javax.swing.table.DefaultTableModel;
import javax.swing.table.JTableHeader;
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.GridLayout;
import java.util.List;

/** Small builders shared by the desktop panels: read-only tables, KPI cards, section headings. */
final class UiSupport {

    private UiSupport() {
    }

    static JTable readOnlyTable(String[] columns, List<Object[]> rows) {
        DefaultTableModel model = new DefaultTableModel(columns, 0) {
            @Override
            public boolean isCellEditable(int r, int c) {
                return false;
            }
        };
        for (Object[] row : rows) {
            model.addRow(row);
        }
        JTable table = new JTable(model);
        table.setRowHeight(28);
        table.setFont(Theme.BODY);
        table.setSelectionMode(ListSelectionModel.SINGLE_SELECTION);
        table.setGridColor(Theme.LINE);
        table.setShowVerticalLines(false);
        JTableHeader header = table.getTableHeader();
        header.setFont(Theme.H2);
        header.setBackground(Theme.MIST);
        header.setForeground(Theme.INK);
        return table;
    }

    static JScrollPane scroll(JComponent component) {
        JScrollPane pane = new JScrollPane(component);
        pane.setBorder(new EmptyBorder(0, 0, 0, 0));
        pane.getViewport().setBackground(Color.WHITE);
        return pane;
    }

    static JPanel kpiCard(String label, String value, Color accent) {
        JPanel card = new JPanel(new BorderLayout(0, 6));
        card.setBackground(Color.WHITE);
        card.setBorder(javax.swing.BorderFactory.createCompoundBorder(
                javax.swing.BorderFactory.createLineBorder(Theme.LINE),
                new EmptyBorder(14, 16, 14, 16)));
        JLabel value_ = new JLabel(value);
        value_.setFont(Theme.H1);
        value_.setForeground(accent);
        JLabel label_ = new JLabel(label.toUpperCase());
        label_.setFont(Theme.BODY);
        label_.setForeground(new Color(0x6B, 0x7A, 0x84));
        card.add(value_, BorderLayout.CENTER);
        card.add(label_, BorderLayout.SOUTH);
        card.setPreferredSize(new Dimension(180, 84));
        return card;
    }

    static JPanel kpiRow(JPanel... cards) {
        JPanel row = new JPanel(new GridLayout(1, 0, 12, 0));
        row.setBackground(Color.WHITE);
        for (JPanel card : cards) {
            row.add(card);
        }
        return row;
    }

    static JLabel heading(String text) {
        JLabel label = new JLabel(text);
        label.setFont(Theme.H2);
        label.setForeground(Theme.INK);
        label.setBorder(new EmptyBorder(6, 2, 6, 2));
        return label;
    }

    static JPanel toolbar(java.awt.Component... items) {
        JPanel bar = new JPanel(new FlowLayout(FlowLayout.LEFT, 8, 6));
        bar.setBackground(Color.WHITE);
        for (java.awt.Component item : items) {
            bar.add(item);
        }
        return bar;
    }
}
