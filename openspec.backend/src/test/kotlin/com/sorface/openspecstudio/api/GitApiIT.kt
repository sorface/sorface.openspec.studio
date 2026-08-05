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
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.nio.file.Path

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(GitApiIT.GitTestConfiguration::class)
@DisplayName("Store Git HTTP/SSE API Kotlin backend")
class GitApiIT {
    @LocalServerPort private var port: Int = 0
    @Autowired private lateinit var objectMapper: ObjectMapper
    private val client = HttpClient.newHttpClient()

    @Test
    fun `status stage commit branches fetch push и SSE совместимы с frontend`() {
        val csrf = sessionToken()
        val created = send("POST", "/api/v1/projects", """{"name":"Git","storePath":"$STORE"}""", csrf)
        val projectId = json(created)["id"].asText()
        val initial = json(send("GET", "/api/v1/projects/$projectId/git/status"))
        assertThat(initial["branch"].asText()).isEqualTo("main")

        Files.writeString(STORE.resolve("README.md"), "updated\n")
        val staged = send("POST", "/api/v1/projects/$projectId/git/stage", """{"paths":["README.md"]}""", csrf)
        assertThat(staged.statusCode()).isEqualTo(200)
        assertThat(json(staged)["changes"][0]["index"].asText()).isNotBlank()

        val committed = send(
            "POST", "/api/v1/projects/$projectId/git/commits",
            objectMapper.writeValueAsString(mapOf("paths" to listOf("README.md"), "message" to "docs: update readme", "expectedHead" to initial["head"].asText())),
            csrf,
        )
        assertThat(committed.statusCode()).isEqualTo(201)
        assertThat(json(committed)["head"].asText()).isNotEqualTo(initial["head"].asText())

        assertThat(send("POST", "/api/v1/projects/$projectId/git/branches", """{"name":"feature/api"}""", csrf).statusCode())
            .isEqualTo(201)
        val switched = send("POST", "/api/v1/projects/$projectId/git/branch-switches", """{"branch":"main"}""", csrf)
        assertThat(json(switched)["branch"].asText()).isEqualTo("main")

        val fetch = send("POST", "/api/v1/projects/$projectId/git/fetches", """{"remote":"origin"}""", csrf)
        assertThat(fetch.statusCode()).isEqualTo(202)
        val fetchOperation = awaitTerminal(projectId, json(fetch)["id"].asText())
        assertThat(fetchOperation["kind"].asText()).isEqualTo("store_git")
        assertThat(fetchOperation["gitAction"].asText()).isEqualTo("fetch")
        val sse = send("GET", "/api/v1/projects/$projectId/git/operations/${fetchOperation["id"].asText()}/events")
        assertThat(sse.body()).contains("event:queued", "event:completed")

        val push = send("POST", "/api/v1/projects/$projectId/git/pushes", "{}", csrf)
        assertThat(push.statusCode()).isEqualTo(202)
        val pushOperation = awaitTerminal(projectId, json(push)["id"].asText())
        assertThat(pushOperation["status"].asText()).isEqualTo("completed")
        assertThat(pushOperation["gitAction"].asText()).isEqualTo("push")
        assertThat(pushOperation["gitBranch"].asText()).isEqualTo("main")
    }

    @Test
    fun `защищает commit optimistic checks и selection`() {
        val csrf = sessionToken()
        val created = send("POST", "/api/v1/projects", """{"name":"Guard","storePath":"$STORE"}""", csrf)
        val projectId = json(created)["id"].asText()

        val invalid = send("POST", "/api/v1/projects/$projectId/git/commits",
            """{"paths":["README.md"],"message":"bad","expectedHead":"stale"}""", csrf)
        val traversal = send("POST", "/api/v1/projects/$projectId/git/stage", """{"paths":["../secret"]}""", csrf)

        assertThat(invalid.statusCode()).isEqualTo(400)
        assertThat(json(invalid)["error"]["code"].asText()).isEqualTo("GIT_INVALID_COMMIT_MESSAGE")
        assertThat(traversal.statusCode()).isEqualTo(400)
        assertThat(json(traversal)["error"]["code"].asText()).isEqualTo("INVALID_STORE_PATH")
    }

    private fun awaitTerminal(projectId: String, operationId: String): JsonNode {
        repeat(300) {
            val result = json(send("GET", "/api/v1/projects/$projectId/git/operations/$operationId"))
            if (result["status"].asText() in setOf("completed", "failed", "cancelled")) return result
            Thread.sleep(10)
        }
        error("Git operation did not finish")
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
    class GitTestConfiguration {
        @Bean @Primary
        fun gitStoreManager(): StoreManager = object : StoreManager {
            override fun validate(path: String): String = Path.of(path).toRealPath().toString()
            override fun clone(remote: String): String = error("unused")
        }
    }

    companion object {
        private val ROOT = Files.createTempDirectory("git-api")
        private val REMOTE = ROOT.resolve("remote.git")
        val STORE: Path = ROOT.resolve("store")

        @JvmStatic @BeforeAll
        fun prepareRepository() {
            git(ROOT, "init", "--bare", REMOTE.toString())
            git(ROOT, "init", "-b", "main", STORE.toString())
            git(STORE, "config", "user.name", "API Test")
            git(STORE, "config", "user.email", "api@example.test")
            Files.writeString(STORE.resolve("README.md"), "initial\n")
            git(STORE, "add", "README.md")
            git(STORE, "commit", "-m", "docs: initial")
            git(STORE, "remote", "add", "origin", REMOTE.toString())
            git(STORE, "push", "-u", "origin", "main")
        }

        private fun git(directory: Path, vararg arguments: String) {
            val process = ProcessBuilder(listOf("git", "-C", directory.toString()) + arguments).redirectErrorStream(true).start()
            val output = process.inputStream.bufferedReader().readText()
            check(process.waitFor() == 0) { output }
        }
    }
}
