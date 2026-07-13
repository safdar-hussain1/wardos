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
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A small read-only JSON API over the hospital, on the JDK's built-in HTTP
 * server — no web framework, no extra dependency.
 *
 * <p><b>This endpoint serves patient data, so it is not open.</b> Three things
 * guard it, and they are worth stating because the obvious version of this class
 * had none of them:
 *
 * <ul>
 *   <li>it binds to <b>loopback only</b>, so it is not reachable from the
 *       network unless someone deliberately puts a proxy in front of it;</li>
 *   <li>every {@code /api/*} request must carry {@code Authorization: Bearer
 *       <token>}, compared in <b>constant time</b>. The token comes from
 *       {@code HEALTH_HAVEN_API_TOKEN} or is generated and printed at startup;</li>
 *   <li>there is <b>no CORS header</b>. An earlier draft sent
 *       {@code Access-Control-Allow-Origin: *}, which would have invited any web
 *       page the operator happened to visit to read the ward list.</li>
 * </ul>
 *
 * <p>Diagnoses are the most sensitive field here and are only served on
 * {@code /api/admissions}, which — like every other route — requires the token.
 */
public final class ApiServer {

    private static final String TOKEN_ENV = "HEALTH_HAVEN_API_TOKEN";

    private final HealthHaven app;
    private final int port;
    private final String token;
    private HttpServer server;

    public ApiServer(HealthHaven app, int port) {
        this(app, port, resolveToken());
    }

    public ApiServer(HealthHaven app, int port, String token) {
        this.app = app;
        this.port = port;
        this.token = token;
    }

    /** The bearer token this server will accept. Printed at startup when generated. */
    public String token() {
        return token;
    }

    private static String resolveToken() {
        String configured = System.getenv(TOKEN_ENV);
        if (configured != null && !configured.isBlank()) {
            return configured.trim();
        }
        byte[] random = new byte[32];
        new SecureRandom().nextBytes(random);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(random);
    }

    public void start() throws IOException {
        // Loopback only. Binding 0.0.0.0 would put the ward list on the network.
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), port), 0);
        server.createContext("/api/summary", secured(e -> summary()));
        server.createContext("/api/beds", secured(e -> beds()));
        server.createContext("/api/patients", secured(e -> patients()));
        server.createContext("/api/admissions", secured(e -> admissions()));
        server.createContext("/api/staff", secured(e -> staff()));
        server.createContext("/api/audit", secured(e -> new com.healthhaven.report.AuditReport().asData()));
        server.createContext("/", ApiServer::index);
        server.setExecutor(null);
        server.start();
    }

    public void stop() {
        if (server != null) {
            server.stop(0);
        }
    }

    private Object summary() {
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

    /** Wraps a handler in bearer-token authentication. */
    private com.sun.net.httpserver.HttpHandler secured(Handler handler) {
        return exchange -> {
            if (!isAuthorised(exchange)) {
                // Say nothing about why. A 401 that explains itself is a hint.
                respond(exchange, 401, "{\"error\":\"unauthorised\"}");
                return;
            }
            try {
                respond(exchange, 200, Json.write(handler.handle(exchange)));
            } catch (Exception e) {
                respond(exchange, 500, "{\"error\":\"request failed\"}");
            }
        };
    }

    private boolean isAuthorised(HttpExchange exchange) {
        String header = exchange.getRequestHeaders().getFirst("Authorization");
        if (header == null || !header.startsWith("Bearer ")) {
            return false;
        }
        String presented = header.substring("Bearer ".length()).trim();
        // Constant-time: a byte-by-byte compare that returns early leaks the token
        // one character at a time to anyone willing to time the responses.
        return MessageDigest.isEqual(
                presented.getBytes(StandardCharsets.UTF_8),
                token.getBytes(StandardCharsets.UTF_8));
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json; charset=utf-8");
        // No Access-Control-Allow-Origin: this data is not for other people's web pages.
        exchange.getResponseHeaders().add("Cache-Control", "no-store");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    private static void index(HttpExchange exchange) throws IOException {
        String body = """
                Health Haven API — every /api route requires a bearer token.

                  curl -H "Authorization: Bearer $HEALTH_HAVEN_API_TOKEN" \\
                       http://localhost:8080/api/summary

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
