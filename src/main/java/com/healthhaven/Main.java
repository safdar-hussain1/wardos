package com.healthhaven;

import com.healthhaven.cli.Cli;
import com.healthhaven.report.DashboardExporter;
import com.healthhaven.ui.DesktopApp;
import com.healthhaven.web.ApiServer;

import java.nio.file.Path;
import java.util.Arrays;

/**
 * The one entry point, dispatching to the surface the caller asked for.
 *
 * <pre>
 *   (no args) | ui       launch the Swing desktop app
 *   cli [...]           run a console command (see: cli help)
 *   serve [port]        start the read-only JSON API (default 8080)
 *   export [file]       write the dashboard data file (default docs/data/dashboard.json)
 *   audit               print the original-vs-rebuilt audit and exit
 * </pre>
 */
public final class Main {

    public static void main(String[] args) throws Exception {
        String mode = args.length == 0 ? "ui" : args[0];
        String[] rest = args.length <= 1 ? new String[0] : Arrays.copyOfRange(args, 1, args.length);

        switch (mode) {
            case "ui" -> DesktopApp.launch();
            case "cli" -> Cli.main(rest);
            case "serve" -> serve(rest);
            case "export" -> export(rest);
            case "audit" -> new Cli(AppContext.seededInMemory(), System.out).dispatch(new String[]{"audit"});
            case "help", "--help", "-h" -> usage();
            default -> {
                System.err.println("Unknown mode: " + mode);
                usage();
            }
        }
    }

    private static void serve(String[] rest) throws Exception {
        int port = rest.length > 0 ? Integer.parseInt(rest[0]) : 8080;
        HealthHaven app = AppContext.openOnDisk(AppContext.defaultDatabasePath());
        ApiServer server = new ApiServer(app, port);
        server.start();
        System.out.println("Health Haven API listening on http://localhost:" + port + " (loopback only)");
        System.out.println();
        System.out.println("This API serves patient data. Every /api route needs the bearer token:");
        System.out.println("  " + server.token());
        System.out.println();
        System.out.println("  curl -H \"Authorization: Bearer " + server.token() + "\" \\");
        System.out.println("       http://localhost:" + port + "/api/summary");
        System.out.println();
        System.out.println("Set HEALTH_HAVEN_API_TOKEN to pin the token across restarts. Ctrl+C to stop.");
        Thread.currentThread().join();
    }

    private static void export(String[] rest) throws Exception {
        Path file = rest.length > 0 ? Path.of(rest[0]) : Path.of("docs", "data", "dashboard.json");
        // Export from a fresh, deterministic in-memory seed so the published data
        // is reproducible and independent of any local database's history.
        HealthHaven app = AppContext.seededInMemory();
        new DashboardExporter(app).exportTo(file);
        System.out.println("Wrote dashboard data to " + file.toAbsolutePath());
    }

    private static void usage() {
        System.out.println("""
                Health Haven — hospital management system

                Usage: java -jar health-haven.jar [mode] [args]

                  ui                 launch the desktop app (default)
                  cli [command]      console interface; try: cli help
                  serve [port]       start the JSON API (default port 8080)
                  export [file]      write the dashboard data file
                  audit              print the original-vs-rebuilt audit
                """);
    }
}
