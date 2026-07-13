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
 * <p>The look-and-feel is installed once, here, before any window exists — not
 * from inside a screen's constructor, where it would apply to whatever happened
 * to be built afterwards. Layout is done with real layout managers rather than
 * absolute {@code setBounds} calls, so the windows resize.
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
