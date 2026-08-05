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

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(RepositoryApiIT.RepositoryTestConfiguration::class)
@DisplayName("Repository HTTP/SSE API Kotlin backend")
class RepositoryApiIT {
    @LocalServerPort private var port: Int = 0
    @Autowired private lateinit var objectMapper: ObjectMapper
    private val client = HttpClient.newHttpClient()

    @Test
    fun `обслуживает clone list branch update и SSE frontend contract`() {
        val csrf = sessionToken()
        val project = send("POST", "/api/v1/projects", """{"name":"Repo","storePath":"$STORE"}""", csrf)
        val projectId = json(project)["id"].asText()

        val started = send(
            "POST", "/api/v1/projects/$projectId/repository-clones",
            """{"url":"https://example.com/team/code.git"}""", csrf,
        )
        assertThat(started.statusCode()).isEqualTo(202)
        val operationId = json(started)["id"].asText()
        val completed = awaitCompleted(projectId, operationId)
        assertThat(completed["status"].asText()).isEqualTo("completed")

        val sse = send("GET", "/api/v1/projects/$projectId/repository-clones/$operationId/events")
        assertThat(sse.statusCode()).isEqualTo(200)
        assertThat(sse.headers().firstValue("content-type").orElse("")).contains("text/event-stream")
        assertThat(sse.body()).contains("event:queued", "event:completed")

        val items = json(send("GET", "/api/v1/projects/$projectId/repositories"))["items"]
        assertThat(items.size()).isEqualTo(1)
        val repositoryId = items[0]["id"].asText()
        val switched = send(
            "POST", "/api/v1/projects/$projectId/repositories/$repositoryId/branch-switches",
            """{"branch":"feature","remote":false}""", csrf,
        )
        assertThat(switched.statusCode()).isEqualTo(200)
        assertThat(json(switched)["branch"].asText()).isEqualTo("feature")
        assertThat(send("POST", "/api/v1/projects/$projectId/repositories/$repositoryId/updates", csrf = csrf).statusCode())
            .isEqualTo(200)
    }

    @Test
    fun `возвращает стабильную ошибку invalid Git URL`() {
        val csrf = sessionToken()
        val project = send("POST", "/api/v1/projects", """{"name":"Invalid","storePath":"$STORE"}""", csrf)
        val projectId = json(project)["id"].asText()

        val response = send("POST", "/api/v1/projects/$projectId/repository-clones", """{"url":"invalid"}""", csrf)

        assertThat(response.statusCode()).isEqualTo(400)
        assertThat(json(response)["error"]["code"].asText()).isEqualTo("INVALID_GIT_URL")
    }

    private fun awaitCompleted(projectId: String, operationId: String): JsonNode {
        repeat(200) {
            val operation = json(send("GET", "/api/v1/projects/$projectId/repository-clones/$operationId"))
            if (operation["status"].asText() in setOf("completed", "failed", "cancelled")) return operation
            Thread.sleep(5)
        }
        error("clone did not finish")
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
    class RepositoryTestConfiguration {
        @Bean @Primary
        fun repositoryStoreManager(): StoreManager = object : StoreManager {
            override fun validate(path: String): String = Path.of(path).toRealPath().toString()
            override fun clone(remote: String): String = error("unused")
        }

        @Bean @Primary
        fun repositoryProcessRunner(): ProcessRunner = FakeGitRunner()
    }

    private class FakeGitRunner : ProcessRunner {
        @Volatile private var branch = "main"
        override fun run(command: ProcessCommand, cancellation: ProcessCancellation): ProcessResult {
            if (command.arguments.firstOrNull() == "switch") branch = command.arguments.last()
            val output = when {
                command.arguments.take(2) == listOf("rev-parse", "--show-toplevel") -> command.directory.toString()
                command.arguments.take(2) == listOf("rev-parse", "HEAD") -> "b".repeat(40)
                command.arguments.take(2) == listOf("branch", "--show-current") -> branch
                command.arguments.take(2) == listOf("status", "--porcelain") -> ""
                command.arguments.contains("@{upstream}") -> "origin/$branch"
                command.arguments.firstOrNull() == "rev-list" -> "0 0"
                command.arguments.lastOrNull() == "refs/heads" -> "main\nfeature"
                command.arguments.lastOrNull() == "refs/remotes" -> "origin/main\norigin/feature"
                else -> ""
            }
            return ProcessResult(output, "", 0, Duration.ofMillis(1), arguments = command.arguments)
        }
    }

    private companion object {
        val STORE: Path = Files.createTempDirectory("repository-api-store").toRealPath()
    }
}
