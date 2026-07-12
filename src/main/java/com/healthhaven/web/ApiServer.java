package com.healthhaven.web;

import com.healthhaven.HealthHaven;
import com.healthhaven.domain.Admission;
import com.healthhaven.domain.Patient;
import com.healthhaven.domain.Room;
import com.healthhaven.domain.StaffMember;
import com.healthhaven.report.Json;
import com.healthhaven.service.ReportingService;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A small read-only JSON API over the hospital, on the JDK's built-in HTTP
 * server — no web framework, no extra dependency.
 *
 * <p>It exists so the system is usable as a service, not only as a desktop app:
 * point anything that speaks HTTP at {@code /api/summary}, {@code /api/beds},
 * {@code /api/patients} and so on. The same seeded data that the dashboard shows
 * is served here live.
 */
public final class ApiServer {

    private final HealthHaven app;
    private final int port;
    private HttpServer server;

    public ApiServer(HealthHaven app, int port) {
        this.app = app;
        this.port = port;
    }

    public void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/api/summary", json(this::summary));
        server.createContext("/api/beds", json(e -> beds()));
        server.createContext("/api/patients", json(e -> patients()));
        server.createContext("/api/admissions", json(e -> admissions()));
        server.createContext("/api/staff", json(e -> staff()));
        server.createContext("/api/audit", json(e -> new com.healthhaven.report.AuditReport().asData()));
        server.createContext("/", ApiServer::index);
        server.setExecutor(null);
        server.start();
    }

    public void stop() {
        if (server != null) {
            server.stop(0);
        }
    }

    private Object summary(HttpExchange exchange) {
        ReportingService r = app.reporting();
        ReportingService.Occupancy occ = r.occupancy();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("patients", app.patients().count());
        m.put("activeAdmissions", r.activeAdmissionCount());
        m.put("occupiedRooms", occ.occupied());
        m.put("totalRooms", occ.total());
        m.put("occupancyRatePct", Math.round(occ.occupancyRate() * 100));
        m.put("totalBilledRupees", r.totalBilled().paise() / 100);
        m.put("outstandingRupees", r.outstanding().paise() / 100);
        m.put("monthlyPayrollRupees", app.staffService().monthlyPayroll().paise() / 100);
        return m;
    }

    private Object beds() {
        List<Map<String, Object>> beds = new ArrayList<>();
        for (Room room : app.rooms().findAll()) {
            boolean occupied = app.admissions().findActiveByRoom(room.roomNo()).isPresent();
            Map<String, Object> b = new LinkedHashMap<>();
            b.put("room", room.roomNo());
            b.put("type", room.type().label());
            b.put("rateRupees", room.nightlyRate().paise() / 100);
            b.put("state", room.outOfService() ? "OUT_OF_SERVICE" : occupied ? "OCCUPIED" : "AVAILABLE");
            beds.add(b);
        }
        return beds;
    }

    private Object patients() {
        List<Map<String, Object>> list = new ArrayList<>();
        for (Patient p : app.patients().findAll()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("mrn", p.mrn());
            m.put("name", p.fullName());
            m.put("age", p.age());
            m.put("gender", p.gender().name());
            list.add(m);
        }
        return list;
    }

    private Object admissions() {
        List<Map<String, Object>> list = new ArrayList<>();
        for (Admission a : app.admissions().findActive()) {
            Patient p = app.patients().findById(a.patientId()).orElseThrow();
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("admissionId", a.id());
            m.put("patient", p.fullName());
            m.put("mrn", p.mrn());
            m.put("room", a.roomNo());
            m.put("nights", a.billableNights(Instant.now()));
            m.put("diagnosis", a.diagnosis());
            list.add(m);
        }
        return list;
    }

    private Object staff() {
        List<Map<String, Object>> list = new ArrayList<>();
        for (StaffMember s : app.staffService().directory()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("code", s.staffCode());
            m.put("name", s.displayName());
            m.put("role", s.role().label());
            m.put("monthlyPayRupees", s.monthlyPay().paise() / 100);
            list.add(m);
        }
        return list;
    }

    private interface Handler {
        Object handle(HttpExchange exchange);
    }

    private static com.sun.net.httpserver.HttpHandler json(Handler handler) {
        return exchange -> {
            try {
                Object result = handler.handle(exchange);
                byte[] body = Json.write(result).getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json; charset=utf-8");
                exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
                exchange.sendResponseHeaders(200, body.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(body);
                }
            } catch (Exception e) {
                byte[] body = ("{\"error\":\"" + e.getMessage() + "\"}").getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(500, body.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(body);
                }
            }
        };
    }

    private static void index(HttpExchange exchange) throws IOException {
        String body = """
                Health Haven API
                ================
                GET /api/summary      hospital status
                GET /api/beds         every room and its state
                GET /api/patients     registered patients
                GET /api/admissions   current admissions
                GET /api/staff        directory with computed pay
                GET /api/audit        original-vs-rebuilt findings
                """;
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "text/plain; charset=utf-8");
        exchange.sendResponseHeaders(200, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }
}
