package com.sorface.openspecstudio.api

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
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(ProjectApiIT.ProjectTestConfiguration::class)
@DisplayName("Project HTTP API Kotlin backend")
class ProjectApiIT {
    @LocalServerPort
    private var port: Int = 0

    @Autowired
    private lateinit var objectMapper: ObjectMapper

    private val client = HttpClient.newHttpClient()

    @Test
    @DisplayName("выполняет CRUD с сохранением в SQLite")
    fun performsCrud() {
        val csrf = sessionToken()
        val createdResponse = send(
            "POST",
            "/api/v1/projects",
            """{"name":"Platform","storePath":"/input/store"}""",
            csrf,
        )
        assertThat(createdResponse.statusCode()).isEqualTo(201)
        val created = json(createdResponse)
        val id = created["id"].asText()
        assertThat(created["storePath"].asText()).isEqualTo("/canonical/store")

        val updated = send(
            "PATCH",
            "/api/v1/projects/$id",
            """{"name":"Platform 2","defaultAiProvider":"codex","defaultModel":"gpt-test"}""",
            csrf,
        )
        assertThat(updated.statusCode()).isEqualTo(200)
        assertThat(json(updated)["name"].asText()).isEqualTo("Platform 2")

        val listed = send("GET", "/api/v1/projects")
        assertThat(listed.statusCode()).isEqualTo(200)
        val items = json(listed)["items"]
        assertThat((0 until items.size()).map { index -> items[index]["id"].asText() }).contains(id)

        assertThat(send("DELETE", "/api/v1/projects/$id", csrf = csrf).statusCode()).isEqualTo(204)
        val missing = send("GET", "/api/v1/projects/$id")
        assertThat(missing.statusCode()).isEqualTo(404)
        assertThat(json(missing)["error"]["code"].asText()).isEqualTo("PROJECT_NOT_FOUND")
    }

    @Test
    @DisplayName("создаёт project from-git через тот же HTTP и persistence контракт")
    fun createsFromGit() {
        val response = send(
            "POST",
            "/api/v1/projects/from-git",
            """{"name":"Imported","url":"git@example.com:team/store.git"}""",
            sessionToken(),
        )

        assertThat(response.statusCode()).isEqualTo(201)
        assertThat(json(response)["name"].asText()).isEqualTo("Imported")
        assertThat(json(response)["storePath"].asText()).isEqualTo(CLONED_STORE.toString())
    }

    private fun sessionToken(): String = json(send("GET", "/api/v1/system/session"))["csrfToken"].asText()

    private fun send(method: String, path: String, body: String = "", csrf: String? = null): HttpResponse<String> {
        val builder = HttpRequest.newBuilder(URI("http://127.0.0.1:$port$path"))
        if (csrf != null) builder.header("X-CSRF-Token", csrf)
        if (body.isNotEmpty()) builder.header("Content-Type", "application/json")
        val publisher = if (body.isEmpty()) HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofString(body)
        return client.send(builder.method(method, publisher).build(), HttpResponse.BodyHandlers.ofString())
    }

    private fun json(response: HttpResponse<String>): JsonNode = objectMapper.readTree(response.body())

    @TestConfiguration(proxyBeanMethods = false)
    class ProjectTestConfiguration {
        @Bean
        @Primary
        fun testStoreManager(): StoreManager = object : StoreManager {
            override fun validate(path: String): String = "/canonical/store"
            override fun clone(remote: String): String = CLONED_STORE.toString()
        }
    }

    private companion object {
        val CLONED_STORE = Files.createTempDirectory("openspec-cloned-store").toRealPath()
    }
}
