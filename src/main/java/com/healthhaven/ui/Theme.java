package com.healthhaven.ui;

import java.awt.Color;
import java.awt.Font;

/** Shared colours and fonts, so the desktop client looks like one product. */
final class Theme {

    static final Color INK = new Color(0x14, 0x2A, 0x3B);
    static final Color TEAL = new Color(0x0E, 0x7C, 0x7B);
    static final Color TEAL_DARK = new Color(0x0A, 0x5A, 0x59);
    static final Color MIST = new Color(0xF3, 0xF6, 0xF8);
    static final Color LINE = new Color(0xDD, 0xE4, 0xE8);
    static final Color OCCUPIED = new Color(0xE1, 0x5A, 0x4C);
    static final Color AVAILABLE = new Color(0x2E, 0x9E, 0x6B);
    static final Color OUT = new Color(0x9A, 0xA6, 0xAD);

    static final Font H1 = new Font("SansSerif", Font.BOLD, 22);
    static final Font H2 = new Font("SansSerif", Font.BOLD, 15);
    static final Font BODY = new Font("SansSerif", Font.PLAIN, 13);
    static final Font MONO = new Font("Monospaced", Font.PLAIN, 13);

    private Theme() {
    }
}
