package com.healthhaven.web;

import com.healthhaven.AppContext;
import com.healthhaven.HealthHaven;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The API serves patient names, MRNs and diagnoses. These pin down the fact that
 * it does not serve them to just anybody.
 */
class ApiServerSecurityTest {

    private static final String TOKEN = "test-token-do-not-reuse";

    private ApiServer server;
    private int port;
    private final HttpClient http = HttpClient.newHttpClient();

    @BeforeEach
    void setUp() throws IOException {
        port = freePort();
        HealthHaven app = AppContext.seededInMemory();
        server = new ApiServer(app, port, TOKEN);
        server.start();
    }

    @AfterEach
    void tearDown() {
        server.stop();
    }

    @Test
    @DisplayName("patient data is refused without a token")
    void refusesAnonymousRequests() throws Exception {
        assertThat(get("/api/patients", null).statusCode()).isEqualTo(401);
        assertThat(get("/api/admissions", null).statusCode()).isEqualTo(401);
        assertThat(get("/api/summary", null).statusCode()).isEqualTo(401);
    }

    @Test
    @DisplayName("a wrong token is refused")
    void refusesWrongToken() throws Exception {
        assertThat(get("/api/patients", "not-the-token").statusCode()).isEqualTo(401);
        // A prefix of the real token must not be accepted either.
        assertThat(get("/api/patients", TOKEN.substring(0, 8)).statusCode()).isEqualTo(401);
    }

    @Test
    @DisplayName("the right token gets the data")
    void servesWithToken() throws Exception {
        HttpResponse<String> response = get("/api/admissions", TOKEN);
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.body()).contains("diagnosis");
    }

    @Test
    @DisplayName("no CORS header invites other origins to read the ward list")
    void sendsNoCorsHeader() throws Exception {
        HttpResponse<String> response = get("/api/summary", TOKEN);
        assertThat(response.headers().firstValue("Access-Control-Allow-Origin")).isEmpty();
    }

    @Test
    @DisplayName("an unauthorised response leaks nothing about why")
    void unauthorisedResponseIsOpaque() throws Exception {
        HttpResponse<String> response = get("/api/patients", "wrong");
        assertThat(response.body()).doesNotContain(TOKEN);
        assertThat(response.body()).isEqualTo("{\"error\":\"unauthorised\"}");
    }

    private HttpResponse<String> get(String path, String token) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder()
                .uri(URI.create("http://localhost:" + port + path));
        if (token != null) {
            request.header("Authorization", "Bearer " + token);
        }
        return http.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    private static int freePort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        }
    }
}
