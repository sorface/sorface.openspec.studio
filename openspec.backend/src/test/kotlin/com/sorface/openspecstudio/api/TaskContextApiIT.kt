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
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.nio.file.Path

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TaskContextApiIT.Configuration::class)
@DisplayName("Task workspace и publication HTTP API")
class TaskContextApiIT {
    @LocalServerPort private var port = 0
    @Autowired private lateinit var mapper: ObjectMapper
    private val client = HttpClient.newHttpClient()

    @Test
    fun `remote sync preview stale guard commit и push работают end-to-end`() {
        val csrf = token()
        val project = json(send("POST", "/api/v1/projects", """{"name":"Tasks","storePath":"$STORE"}""", csrf))
        val projectId = project["id"].asText()
        val initial = json(send("GET", "/api/v1/projects/$projectId/task-workspaces"))
        assertThat(initial["active"]["branch"].asText()).isEqualTo("main")

        val opened = json(send("POST", "/api/v1/projects/$projectId/task-workspaces",
            """{"remoteBranch":"origin/BILL-1842"}""", csrf))
        val active = opened["active"]
        assertThat(active["branch"].asText()).isEqualTo("BILL-1842")
        assertThat(active["managed"].asBoolean()).isTrue()
        val worktree = DATA.resolve("task-worktrees").resolve(projectId).resolve(active["id"].asText())

        val contributor = ROOT.resolve("contributor")
        git(ROOT, "clone", REMOTE.toString(), contributor.toString())
        git(contributor, "config", "user.name", "Remote Test")
        git(contributor, "config", "user.email", "remote@example.test")
        git(contributor, "switch", "BILL-1842")
        Files.writeString(contributor.resolve("remote.txt"), "remote\n")
        git(contributor, "add", "remote.txt")
        git(contributor, "commit", "-m", "chore: remote update")
        git(contributor, "push")

        val synced = json(send("POST", "/api/v1/projects/$projectId/task-workspaces/sync", "", csrf))
        assertThat(synced["updated"].asBoolean()).isTrue()
        assertThat(synced["head"].asText()).isNotEqualTo(synced["previousHead"].asText())

        Files.createDirectories(worktree.resolve("openspec"))
        Files.writeString(worktree.resolve("openspec/spec.md"), "# Billing\n")
        Files.writeString(worktree.resolve("notes.txt"), "excluded\n")
        val preview = json(send("POST", "/api/v1/projects/$projectId/task-publications/preview", "", csrf))
        assertThat(preview["task"].asText()).isEqualTo("BILL-1842")
        assertThat(preview["paths"].size()).isEqualTo(1)
        assertThat(preview["paths"][0].asText()).isEqualTo("openspec/spec.md")
        assertThat(preview["excludedCount"].asInt()).isGreaterThanOrEqualTo(1)

        Files.writeString(worktree.resolve("openspec/spec.md"), "# Billing changed\n")
        val stale = send("POST", "/api/v1/projects/$projectId/task-publications",
            mapper.writeValueAsString(mapOf("token" to preview["token"].asText())), csrf)
        assertThat(stale.statusCode()).isEqualTo(409)
        assertThat(json(stale)["error"]["code"].asText()).isEqualTo("PUBLICATION_STALE")

        val fresh = json(send("POST", "/api/v1/projects/$projectId/task-publications/preview", "", csrf))
        val published = send("POST", "/api/v1/projects/$projectId/task-publications", mapper.writeValueAsString(mapOf(
            "token" to fresh["token"].asText(), "message" to "BILL-1842: обновить спецификацию", "body" to "- Обновлена billing spec",
        )), csrf)
        assertThat(published.statusCode()).isEqualTo(202)
        val result = json(published)
        assertThat(result["commitSha"].asText()).hasSize(40)
        assertThat(result["operation"]["kind"].asText()).isEqualTo("store_git")
        assertThat(result["operation"]["gitAction"].asText()).isEqualTo("push")
    }

    private fun token() = json(send("GET", "/api/v1/system/session"))["csrfToken"].asText()
    private fun send(method: String, path: String, body: String = "", csrf: String? = null): HttpResponse<String> {
        val request = HttpRequest.newBuilder(URI("http://127.0.0.1:$port$path"))
        if (csrf != null) request.header("X-CSRF-Token", csrf)
        if (body.isNotEmpty()) request.header("Content-Type", "application/json")
        return client.send(request.method(method, if (body.isEmpty()) HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofString(body)).build(),
            HttpResponse.BodyHandlers.ofString())
    }
    private fun json(response: HttpResponse<String>): JsonNode = mapper.readTree(response.body())

    @TestConfiguration(proxyBeanMethods = false)
    class Configuration {
        @Bean @Primary fun taskStoreManager(): StoreManager = object : StoreManager {
            override fun validate(path: String) = Path.of(path).toRealPath().toString()
            override fun clone(remote: String) = error("unused")
        }
    }

    companion object {
        private val ROOT = Files.createTempDirectory("task-context-api")
        private val DATA = ROOT.resolve("data")
        private val REMOTE = ROOT.resolve("remote.git")
        private val STORE = ROOT.resolve("store")

        @JvmStatic @DynamicPropertySource
        fun properties(registry: DynamicPropertyRegistry) = registry.add("openspec.server.data-dir") { DATA.toString() }

        @JvmStatic @BeforeAll
        fun prepare() {
            Files.createDirectories(DATA)
            git(ROOT, "init", "--bare", REMOTE.toString())
            git(ROOT, "init", "-b", "main", STORE.toString())
            git(STORE, "config", "user.name", "Task Test")
            git(STORE, "config", "user.email", "task@example.test")
            Files.writeString(STORE.resolve("README.md"), "initial\n")
            git(STORE, "add", "README.md")
            git(STORE, "commit", "-m", "chore: initial")
            git(STORE, "remote", "add", "origin", REMOTE.toString())
            git(STORE, "push", "-u", "origin", "main")
            git(STORE, "push", "origin", "main:BILL-1842")
            git(STORE, "fetch", "origin")
        }

        private fun git(directory: Path, vararg args: String) {
            val process = ProcessBuilder(listOf("git", "-C", directory.toString()) + args).redirectErrorStream(true).start()
            val output = process.inputStream.bufferedReader().readText()
            check(process.waitFor() == 0) { output }
        }
    }
}
