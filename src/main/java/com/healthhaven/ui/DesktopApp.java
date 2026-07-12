package com.healthhaven.ui;

import com.formdev.flatlaf.FlatLightLaf;
import com.healthhaven.AppContext;
import com.healthhaven.HealthHaven;

import javax.swing.SwingUtilities;
import javax.swing.UIManager;

/**
 * Boots the desktop client: install a modern look-and-feel, seed the database,
 * show the login window.
 *
 * <p>The original set the system look-and-feel from inside one screen's
 * constructor and used absolute pixel {@code setBounds} everywhere, which is why
 * every window was a fixed-size box with buttons whose black text sat on black
 * backgrounds. This uses FlatLaf and real layout managers.
 */
public final class DesktopApp {

    private DesktopApp() {
    }

    public static void launch() {
        try {
            UIManager.setLookAndFeel(new FlatLightLaf());
            UIManager.put("Button.arc", 10);
            UIManager.put("Component.arc", 10);
            UIManager.put("TextComponent.arc", 8);
        } catch (Exception e) {
            // Fall back to the default look-and-feel; not worth failing the launch over.
        }
        HealthHaven app = AppContext.openOnDisk(AppContext.defaultDatabasePath());
        SwingUtilities.invokeLater(() -> new LoginWindow(app).setVisible(true));
    }
}
