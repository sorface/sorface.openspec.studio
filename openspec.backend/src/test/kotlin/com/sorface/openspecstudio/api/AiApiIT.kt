package com.sorface.openspecstudio.api

import com.sorface.openspecstudio.application.ProcessCancellation
import com.sorface.openspecstudio.application.ProcessCommand
import com.sorface.openspecstudio.application.ProcessResult
import com.sorface.openspecstudio.application.ProcessRunner
import com.sorface.openspecstudio.application.StoreManager
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import org.springframework.context.annotation.Primary
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = ["ai.cli.path=/bin/sh"])
@Import(AiApiIT.Configuration::class)
@DisplayName("AI HTTP/SSE API Kotlin backend")
class AiApiIT {
    @LocalServerPort private var port: Int = 0
    @Autowired private lateinit var mapper: ObjectMapper
    private val client = HttpClient.newHttpClient()

    @Test
    fun `создаёт manifest выполняет operation и отдаёт SSE replay`() {
        val csrf = token()
        val projectId = json(send("POST", "/api/v1/projects", """{"name":"AI","storePath":"$STORE"}""", csrf))["id"].asText()
        val manifest = send("POST", "/api/v1/projects/$projectId/ai/context-manifests", """{"files":[]}""", csrf)
        assertThat(manifest.statusCode()).isEqualTo(200)
        val reviewToken = json(manifest)["reviewToken"].asText()

        val started = send("POST", "/api/v1/projects/$projectId/ai/operations",
            """{"reviewToken":"$reviewToken","prompt":"Обнови","provider":"codex","reasoningEffort":"low"}""", csrf)
        assertThat(started.statusCode()).isEqualTo(202)
        val id = json(started)["id"].asText()
        val completed = await(projectId, id)
        assertThat(completed["status"].asText()).isEqualTo("awaiting_review")
        assertThat(completed["result"].asText()).contains("openspec/config.yaml", "готово")

        val events = send("GET", "/api/v1/projects/$projectId/ai/operations/$id/events")
        assertThat(events.statusCode()).isEqualTo(200)
        assertThat(events.headers().firstValue("content-type").orElse("")).contains("text/event-stream")
        assertThat(events.body()).contains("event:queued", "event:awaiting_review")
        assertThat(send("DELETE", "/api/v1/projects/$projectId/ai/operations/$id", csrf = csrf).statusCode()).isEqualTo(200)
    }

    @Test
    fun `проверяет provider ownership и CSRF`() {
        val csrf = token()
        val first = json(send("POST", "/api/v1/projects", """{"name":"One","storePath":"$STORE"}""", csrf))["id"].asText()
        val second = json(send("POST", "/api/v1/projects", """{"name":"Two","storePath":"$STORE"}""", csrf))["id"].asText()
        val withoutCsrf = send("POST", "/api/v1/projects/$first/ai/context-manifests", """{"files":[]}""")
        assertThat(withoutCsrf.statusCode()).isEqualTo(403)
        val token = json(send("POST", "/api/v1/projects/$first/ai/context-manifests", """{"files":[]}""", csrf))["reviewToken"].asText()
        val unsupported = send("POST", "/api/v1/projects/$first/ai/operations",
            """{"reviewToken":"$token","prompt":"test","provider":"unknown"}""", csrf)
        assertThat(unsupported.statusCode()).isEqualTo(400)
        assertThat(json(unsupported)["error"]["code"].asText()).isEqualTo("AI_PROVIDER_UNSUPPORTED")

        val validToken = json(send("POST", "/api/v1/projects/$first/ai/context-manifests", """{"files":[]}""", csrf))["reviewToken"].asText()
        val operation = json(send("POST", "/api/v1/projects/$first/ai/operations",
            """{"reviewToken":"$validToken","prompt":"test","provider":"codex"}""", csrf))
        assertThat(send("GET", "/api/v1/projects/$second/ai/operations/${operation["id"].asText()}").statusCode()).isEqualTo(404)
    }

    private fun await(projectId: String, id: String): JsonNode {
        repeat(300) {
            val item = json(send("GET", "/api/v1/projects/$projectId/ai/operations/$id"))
            if (item["status"].asText() in setOf("awaiting_review", "failed", "cancelled")) return item
            Thread.sleep(5)
        }
        error("AI operation did not finish")
    }
    private fun token() = json(send("GET", "/api/v1/system/session"))["csrfToken"].asText()
    private fun send(method: String, path: String, body: String = "", csrf: String? = null): HttpResponse<String> {
        val builder = HttpRequest.newBuilder(URI("http://127.0.0.1:$port$path"))
        csrf?.let { builder.header("X-CSRF-Token", it) }
        if (body.isNotEmpty()) builder.header("Content-Type", "application/json")
        val publisher = if (body.isEmpty()) HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofString(body)
        return client.send(builder.method(method, publisher).build(), HttpResponse.BodyHandlers.ofString())
    }
    private fun json(response: HttpResponse<String>) = mapper.readTree(response.body())

    @TestConfiguration(proxyBeanMethods = false)
    class Configuration {
        @Bean @Primary fun storeManager(): StoreManager = object : StoreManager {
            override fun validate(path: String) = Path.of(path).toRealPath().toString()
            override fun clone(remote: String) = error("unused")
        }
        @Bean @Primary fun aiRunner(): ProcessRunner = object : ProcessRunner {
            override fun run(command: ProcessCommand, cancellation: ProcessCancellation): ProcessResult {
                Files.writeString(command.directory.resolve("openspec/config.yaml"), "schema: api-changed\n")
                return ProcessResult("{\"type\":\"item.completed\",\"message\":\"готово\"}\n", "", 0, Duration.ofMillis(1), arguments = command.arguments)
            }
        }
    }

    private companion object {
        val STORE: Path = Files.createTempDirectory("ai-api-store").also {
            Files.createDirectories(it.resolve("openspec")); Files.writeString(it.resolve("openspec/config.yaml"), "schema: spec-driven\n")
        }.toRealPath()
    }
}
