package com.sorface.openspecstudio.api

import com.sorface.openspecstudio.application.StoreManager
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import org.springframework.context.annotation.Primary
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(DocumentApiIT.DocumentTestConfiguration::class)
@DisplayName("Document HTTP API Kotlin backend")
class DocumentApiIT {
    @LocalServerPort
    private var port: Int = 0

    @Autowired
    private lateinit var objectMapper: ObjectMapper

    private val client = HttpClient.newHttpClient()

    @Test
    fun `frontend contract перечисляет читает и записывает document`() {
        val csrf = sessionToken()
        val created = send(
            "POST",
            "/api/v1/projects",
            """{"name":"Documents","storePath":"${STORE.toString().replace("\\", "\\\\")}"}""",
            csrf,
        )
        assertThat(created.statusCode()).isEqualTo(201)
        val projectId = json(created)["id"].asText()

        val listed = send("GET", "/api/v1/projects/$projectId/documents")
        assertThat(listed.statusCode()).isEqualTo(200)
        val items = json(listed)["items"]
        assertThat((0 until items.size()).map { index -> items[index]["path"].asText() })
            .contains("openspec/specs/auth/spec.md")

        val path = encoded("openspec/specs/auth/spec.md")
        val read = send("GET", "/api/v1/projects/$projectId/documents/content?path=$path")
        assertThat(read.statusCode()).isEqualTo(200)
        val initial = json(read)
        assertThat(initial["content"].asText()).isEqualTo("# Auth\n")

        val written = send(
            "PUT",
            "/api/v1/projects/$projectId/documents/content",
            objectMapper.writeValueAsString(
                mapOf(
                    "path" to "openspec/specs/auth/spec.md",
                    "content" to "# Updated\n",
                    "baseContentHash" to initial["contentHash"].asText(),
                ),
            ),
            csrf,
        )
        assertThat(written.statusCode()).isEqualTo(200)
        assertThat(json(written)["content"].asText()).isEqualTo("# Updated\n")

        val conflict = send(
            "PUT",
            "/api/v1/projects/$projectId/documents/content",
            objectMapper.writeValueAsString(
                mapOf(
                    "path" to "openspec/specs/auth/spec.md",
                    "content" to "stale",
                    "baseContentHash" to initial["contentHash"].asText(),
                ),
            ),
            csrf,
        )
        assertThat(conflict.statusCode()).isEqualTo(409)
        assertThat(json(conflict)["error"]["code"].asText()).isEqualTo("DRAFT_CONFLICT")

        val annotations = send("GET", "/api/v1/projects/$projectId/documents/annotations?path=$path")
        assertThat(annotations.statusCode()).isEqualTo(200)
        assertThat(json(annotations)["items"][0]["local"].asBoolean()).isTrue()

        val outside = send("GET", "/api/v1/projects/$projectId/documents/content?path=${encoded("README.md")}")
        assertThat(outside.statusCode()).isEqualTo(400)
        assertThat(json(outside)["error"]["code"].asText()).isEqualTo("PATH_OUTSIDE_SCOPE")
    }

    private fun sessionToken(): String = json(send("GET", "/api/v1/system/session"))["csrfToken"].asText()

    private fun encoded(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8)

    private fun send(method: String, path: String, body: String = "", csrf: String? = null): HttpResponse<String> {
        val builder = HttpRequest.newBuilder(URI("http://127.0.0.1:$port$path"))
        if (csrf != null) builder.header("X-CSRF-Token", csrf)
        if (body.isNotEmpty()) builder.header("Content-Type", "application/json")
        val publisher = if (body.isEmpty()) HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofString(body)
        return client.send(builder.method(method, publisher).build(), HttpResponse.BodyHandlers.ofString())
    }

    private fun json(response: HttpResponse<String>): JsonNode = objectMapper.readTree(response.body())

    @TestConfiguration(proxyBeanMethods = false)
    class DocumentTestConfiguration {
        @Bean
        @Primary
        fun documentStoreManager(): StoreManager = object : StoreManager {
            override fun validate(path: String): String = Path.of(path).toRealPath().toString()
            override fun clone(remote: String): String = error("not used")
        }
    }

    companion object {
        private val STORE: Path = Files.createTempDirectory("openspec-document-api-store").toRealPath()

        @JvmStatic
        @BeforeAll
        fun createFixture() {
            val document = STORE.resolve("openspec/specs/auth/spec.md")
            Files.createDirectories(document.parent)
            Files.writeString(document, "# Auth\n")
        }
    }
}
