package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.config.LocalServerProperties
import com.sorface.openspecstudio.domain.ai.AiException
import com.sorface.openspecstudio.domain.ai.ContextEntry
import com.sorface.openspecstudio.domain.ai.ContextIntent
import com.sorface.openspecstudio.domain.ai.ContextManifestCommand
import com.sorface.openspecstudio.domain.ai.CreateAiOperationCommand
import com.sorface.openspecstudio.domain.project.Project
import com.sorface.openspecstudio.domain.project.UpdateProjectCommand
import com.sorface.openspecstudio.domain.repository.CloneOperation
import com.sorface.openspecstudio.domain.repository.OperationEvent
import com.sorface.openspecstudio.domain.repository.RepositoryLink
import com.sorface.openspecstudio.infrastructure.process.ProcessSupervisor
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import tools.jackson.databind.ObjectMapper
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration
import java.time.Instant
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong

@DisplayName("AI operations")
class AiOperationServiceTest {
    @TempDir lateinit var root: Path

    @Test
    fun `фильтрует traversal secrets binary и сохраняет проверенный manifest`() {
        val storeRoot = store()
        Files.writeString(storeRoot.resolve(".env"), "TOKEN=secret")
        Files.write(storeRoot.resolve("binary.bin"), byteArrayOf(0, 1, 2))
        val service = service(storeRoot, MemoryStore(), SuccessfulRunner())

        val manifest = service.manifest(PROJECT, ContextManifestCommand(listOf(
            ContextIntent("store", "openspec/config.yaml"), ContextIntent("store", "../outside"),
            ContextIntent("store", ".env"), ContextIntent("store", "binary.bin"),
        )))

        assertThat(manifest.reviewToken).isNotBlank()
        assertThat(manifest.entries.map { it.reason }).containsExactly("selected", "PATH_OUTSIDE_SCOPE", "DENYLIST", "BINARY_FILE")
        assertThat(manifest.entries.first().checksum).hasSize(64)
        assertThat(manifest.limits["maxFiles"]).isEqualTo(100)
    }

    @Test
    fun `выполняет Agent CLI в снимке и не изменяет Store`() {
        val storeRoot = store()
        val persistence = MemoryStore()
        val runner = SuccessfulRunner()
        val service = service(storeRoot, persistence, runner)
        val manifest = service.manifest(PROJECT, ContextManifestCommand())

        val queued = service.start(PROJECT, CreateAiOperationCommand(manifest.reviewToken, "Обнови schema", "codex", "gpt-5", "low"), "corr")
        val result = await(service, queued.id)

        assertThat(result.status).isEqualTo("awaiting_review")
        assertThat(result.result).contains("openspec/config.yaml", "schema: changed", "готово")
        assertThat(Files.readString(storeRoot.resolve("openspec/config.yaml"))).isEqualTo("schema: spec-driven\n")
        assertThat(persistence.context).singleElement().extracting("path").isEqualTo("openspec/config.yaml")
        assertThat(service.events(PROJECT, queued.id, 0).map { it.type })
            .containsExactly("queued", "running", "provider_event", "validating", "awaiting_review")
        assertThat(runner.command!!.arguments).contains("--sandbox", "workspace-write", "--model", "gpt-5")
        assertThat(runner.command!!.stdin).doesNotContain(storeRoot.toString())
    }

    @Test
    fun `отклоняет stale token provider и конфликт операций`() {
        val storeRoot = store()
        val persistence = MemoryStore()
        val service = service(storeRoot, persistence, SuccessfulRunner())
        val stale = service.manifest(PROJECT, ContextManifestCommand())
        Files.writeString(storeRoot.resolve("openspec/config.yaml"), "schema: externally-changed\n")
        assertCode("AI_CONTEXT_STALE") { service.start(PROJECT, CreateAiOperationCommand(stale.reviewToken, "test", "codex"), "") }

        Files.writeString(storeRoot.resolve("openspec/config.yaml"), "schema: spec-driven\n")
        val unknown = service.manifest(PROJECT, ContextManifestCommand())
        assertCode("AI_PROVIDER_UNSUPPORTED") { service.start(PROJECT, CreateAiOperationCommand(unknown.reviewToken, "test", "unknown"), "") }

        persistence.createOperation(operation("running"))
        val conflict = service.manifest(PROJECT, ContextManifestCommand())
        assertCode("AI_OPERATION_CONFLICT") { service.start(PROJECT, CreateAiOperationCommand(conflict.reviewToken, "test", "codex"), "") }
    }

    @Test
    fun `отменяет активный процесс через supervisor`() {
        val storeRoot = store()
        val service = service(storeRoot, MemoryStore(), BlockingRunner())
        val manifest = service.manifest(PROJECT, ContextManifestCommand())
        val queued = service.start(PROJECT, CreateAiOperationCommand(manifest.reviewToken, "test", "codex"), "")
        repeat(200) { if (service.get(PROJECT, queued.id).status == "running") return@repeat else Thread.sleep(2) }

        assertThat(service.cancel(PROJECT, queued.id).status).isEqualTo("cancelled")
        assertThat(await(service, queued.id).status).isEqualTo("cancelled")
    }

    private fun service(storeRoot: Path, persistence: MemoryStore, runner: ProcessRunner) = AiOperationService(
        FixedProjects(storeRoot), persistence, runner, ProcessSupervisor(), ObjectMapper(), java.time.Clock.systemUTC(),
        LocalServerProperties(dataDir = root.resolve("data"), noBrowser = true), "/bin/sh",
    )

    private fun store(): Path = Files.createDirectories(root.resolve("store/openspec")).parent.also {
        Files.writeString(it.resolve("openspec/config.yaml"), "schema: spec-driven\n")
    }

    private fun await(service: AiOperationService, id: String): CloneOperation {
        repeat(500) { service.get(PROJECT, id).takeIf(CloneOperation::terminal)?.let { return it }; Thread.sleep(2) }
        error("AI operation did not finish")
    }

    private fun assertCode(code: String, block: () -> Unit) {
        assertThatThrownBy(block).isInstanceOf(AiException::class.java).extracting("code").isEqualTo(code)
    }

    private class SuccessfulRunner : ProcessRunner {
        @Volatile var command: ProcessCommand? = null
        override fun run(command: ProcessCommand, cancellation: ProcessCancellation): ProcessResult {
            this.command = command
            val target = command.directory.resolve("openspec/config.yaml")
            Files.writeString(target, "schema: changed\n")
            return ProcessResult("{\"type\":\"item.completed\",\"message\":\"готово\"}\n", "", 0, Duration.ofMillis(1), arguments = command.arguments)
        }
    }

    private class BlockingRunner : ProcessRunner {
        override fun run(command: ProcessCommand, cancellation: ProcessCancellation): ProcessResult {
            repeat(500) { if (cancellation.isCancelled()) return ProcessResult("", "", 143, Duration.ofMillis(it.toLong()), "cancelled"); Thread.sleep(2) }
            return ProcessResult("", "", 0, Duration.ofSeconds(1))
        }
    }

    private class FixedProjects(private val store: Path) : ProjectRepository {
        private val item get() = Project(PROJECT, "AI", store.toString(), createdAt = Instant.EPOCH, updatedAt = Instant.EPOCH)
        override fun list() = listOf(item)
        override fun get(id: String) = item.takeIf { id == PROJECT }
        override fun create(name: String, storePath: String) = error("unused")
        override fun update(id: String, command: UpdateProjectCommand) = error("unused")
        override fun delete(id: String) = false
    }

    private class MemoryStore : RepositoryStore {
        val context = mutableListOf<ContextEntry>()
        private val operations = linkedMapOf<String, CloneOperation>()
        private val events = mutableListOf<OperationEvent>()
        private val sequence = AtomicLong()
        @Synchronized override fun listRepositories(projectId: String) = emptyList<RepositoryLink>()
        override fun createRepository(item: RepositoryLink) = error("unused")
        override fun updateRepository(item: RepositoryLink) = error("unused")
        @Synchronized override fun createOperation(item: CloneOperation) = item.copy(id = item.id.ifBlank(UUID.randomUUID()::toString), createdAt = Instant.now(), updatedAt = Instant.now()).also { operations[it.id] = it }
        @Synchronized override fun getOperation(id: String) = operations[id]
        @Synchronized override fun updateOperation(item: CloneOperation) = item.copy(updatedAt = Instant.now()).also { operations[it.id] = it }
        @Synchronized override fun hasActiveOperation(projectId: String, kind: String) = operations.values.any { it.projectId == projectId && it.kind == kind && !it.terminal() }
        @Synchronized override fun addEvent(operationId: String, type: String, payload: String) = OperationEvent(sequence.incrementAndGet(), operationId, type, payload, Instant.now()).also(events::add)
        @Synchronized override fun listEvents(operationId: String, after: Long) = events.filter { it.operationId == operationId && it.sequence > after }
        @Synchronized override fun saveAiContext(operationId: String, entries: List<ContextEntry>) { context.clear(); context.addAll(entries) }
    }

    private fun operation(status: String) = CloneOperation("", PROJECT, "ai", status, createdAt = Instant.EPOCH, updatedAt = Instant.EPOCH)
    private companion object { const val PROJECT = "project-ai" }
}
