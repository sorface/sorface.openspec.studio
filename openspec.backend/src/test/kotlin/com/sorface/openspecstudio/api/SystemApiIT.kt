package com.sorface.openspecstudio.api

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = ["openspec.server.no-browser=true"])
@DisplayName("Системный HTTP API Kotlin backend")
class SystemApiIT {
    @LocalServerPort
    private var port: Int = 0

    @Autowired
    private lateinit var objectMapper: ObjectMapper

    private val client = HttpClient.newHttpClient()

    @Test
    @DisplayName("возвращает health и защитные заголовки через реальный HTTP server")
    fun returnsHealth() {
        val response = send("GET", "/api/v1/system/health", headers = mapOf("X-Correlation-ID" to "test-id"))
        assertThat(response.statusCode()).isEqualTo(200)
        assertThat(response.headers().firstValue("X-Correlation-ID")).hasValue("test-id")
        assertThat(response.headers().firstValue("X-Content-Type-Options")).hasValue("nosniff")
        assertThat(readJson(response)["status"].asText()).isEqualTo("ready")
        assertThat(readJson(response)["service"].asText()).isEqualTo("openspec-studio")
    }

    @Test
    @DisplayName("выдаёт session token и отклоняет mutation без него")
    fun protectsMutationWithCsrf() {
        val token = readJson(send("GET", "/api/v1/system/session"))["csrfToken"].asText()
        assertThat(token).matches("[a-f0-9]{48}")
        val rejected = send("POST", "/api/v1/projects", body = "{}")
        assertThat(rejected.statusCode()).isEqualTo(403)
        assertThat(readJson(rejected)["error"]["code"].asText()).isEqualTo("CSRF_REJECTED")
    }

    @Test
    @DisplayName("отклоняет внешний origin")
    fun rejectsForeignOrigin() {
        val response = send("GET", "/api/v1/system/health", headers = mapOf("Origin" to "https://example.com"))
        assertThat(response.statusCode()).isEqualTo(403)
        assertThat(readJson(response)["error"]["code"].asText()).isEqualTo("ORIGIN_REJECTED")
    }

    @Test
    @DisplayName("возвращает capabilities без HTTP-кеширования")
    fun returnsCapabilities() {
        val response = send("GET", "/api/v1/system/capabilities")
        assertThat(response.statusCode()).isEqualTo(200)
        assertThat(response.headers().firstValue("Cache-Control").orElse("")).contains("no-store")
        val tools = readJson(response)["tools"]
        assertThat((0..3).map { index -> tools[index]["name"].asText() })
            .containsExactly("git", "openspec", "codex", "gigacode")
    }

    @Test
    @DisplayName("обслуживает embedded frontend")
    fun servesEmbeddedFrontend() {
        val response = send("GET", "/")
        assertThat(response.statusCode()).isEqualTo(200)
        assertThat(response.body()).contains("<title>OpenSpec Studio</title>")
    }

    private fun send(method: String, path: String, body: String = "", headers: Map<String, String> = emptyMap()): HttpResponse<String> {
        val builder = HttpRequest.newBuilder(URI("http://127.0.0.1:$port$path"))
        headers.forEach(builder::header)
        val publisher = if (body.isEmpty()) HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofString(body)
        return client.send(builder.method(method, publisher).build(), HttpResponse.BodyHandlers.ofString())
    }

    private fun readJson(response: HttpResponse<String>): JsonNode = objectMapper.readTree(response.body())
}
