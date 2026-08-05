package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.config.LocalServerProperties
import com.sorface.openspecstudio.domain.project.Project
import com.sorface.openspecstudio.domain.project.UpdateProjectCommand
import com.sorface.openspecstudio.domain.repository.CloneOperation
import com.sorface.openspecstudio.domain.repository.CloneRepositoryCommand
import com.sorface.openspecstudio.domain.repository.OperationEvent
import com.sorface.openspecstudio.domain.repository.RepositoryException
import com.sorface.openspecstudio.domain.repository.RepositoryLink
import com.sorface.openspecstudio.domain.repository.SwitchRepositoryBranchCommand
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

@DisplayName("Repository use cases")
class RepositoryServiceTest {
    @TempDir lateinit var root: Path

    @Test
    fun `валидирует и дедуплицирует context repository URLs`() {
        val service = service(MemoryRepositoryStore(), FakeGitRunner())

        assertThat(service.validateRepositories(listOf(" git@example.com:team/code.git ", "git@example.com:team/code.git")))
            .containsExactly("git@example.com:team/code.git")
        assertThatThrownBy { service.validateRepositories(listOf("https://user:password@example.com/code.git")) }
            .extracting("code").isEqualTo("INVALID_CONTEXT_REPOSITORY_URL")
    }

    @Test
    fun `выполняет async clone сохраняет repository и события`() {
        val store = MemoryRepositoryStore()
        val service = service(store, FakeGitRunner())

        val queued = service.startClone(PROJECT_ID, CloneRepositoryCommand("https://example.com/team/code.git"), "correlation")
        val completed = awaitTerminal(service, queued.id)

        assertThat(queued.status).isEqualTo("queued")
        assertThat(completed.status).isEqualTo("completed")
        assertThat(service.list(PROJECT_ID)).singleElement().extracting("branch").isEqualTo("main")
        assertThat(service.events(PROJECT_ID, queued.id, 0).map { it.type })
            .containsExactly("queued", "running", "validating", "completed")
    }

    @Test
    fun `переключает локальную ветку и обновляет repository`() {
        val store = MemoryRepositoryStore()
        val runner = FakeGitRunner()
        val service = service(store, runner)
        val operation = service.startClone(PROJECT_ID, CloneRepositoryCommand("ssh://git@example.com/team/code.git"), "")
        awaitTerminal(service, operation.id)

        val switched = service.switchBranch(PROJECT_ID, store.repositories.single().id, SwitchRepositoryBranchCommand("feature"))
        val updated = service.update(PROJECT_ID, switched.id)

        assertThat(switched.branch).isEqualTo("feature")
        assertThat(updated.available).isTrue()
        assertThat(runner.commands).contains(listOf("fetch", "--prune"))
    }

    @Test
    fun `отменяет clone через supervisor и очищает operation`() {
        val store = MemoryRepositoryStore()
        val service = service(store, SlowCloneRunner())
        val operation = service.startClone(PROJECT_ID, CloneRepositoryCommand("https://example.com/team/slow.git"), "")
        while (service.get(PROJECT_ID, operation.id).status == "queued") Thread.sleep(5)

        val cancelled = service.cancel(PROJECT_ID, operation.id)

        assertThat(cancelled.status).isEqualTo("cancelled")
        assertThat(awaitTerminal(service, operation.id).status).isEqualTo("cancelled")
    }

    private fun service(store: RepositoryStore, runner: ProcessRunner): RepositoryService = RepositoryService(
        FixedProjectRepository(), store, runner, ProcessSupervisor(), ObjectMapper(),
        LocalServerProperties(dataDir = root.resolve("data"), noBrowser = true),
    )

    private fun awaitTerminal(service: RepositoryService, id: String): CloneOperation {
        repeat(200) {
            val operation = service.get(PROJECT_ID, id)
            if (operation.terminal()) return operation
            Thread.sleep(5)
        }
        error("operation did not finish")
    }

    private class FakeGitRunner : ProcessRunner {
        val commands = mutableListOf<List<String>>()
        private var branch = "main"

        override fun run(command: ProcessCommand, cancellation: ProcessCancellation): ProcessResult {
            synchronized(commands) { commands += command.arguments }
            if (command.arguments.firstOrNull() == "switch") branch = command.arguments.last()
            val output = when {
                command.arguments.take(2) == listOf("rev-parse", "--show-toplevel") -> command.directory.toString()
                command.arguments.take(2) == listOf("rev-parse", "HEAD") -> "a".repeat(40)
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

    private class SlowCloneRunner : ProcessRunner {
        override fun run(command: ProcessCommand, cancellation: ProcessCancellation): ProcessResult {
            if (command.arguments.firstOrNull() == "clone") {
                repeat(500) {
                    if (cancellation.isCancelled()) return ProcessResult("", "", 143, Duration.ofMillis(it.toLong()), "cancelled")
                    Thread.sleep(2)
                }
            }
            return ProcessResult("", "", 0, Duration.ZERO)
        }
    }

    private class FixedProjectRepository : ProjectRepository {
        private val project = Project(PROJECT_ID, "Test", "/store", createdAt = Instant.EPOCH, updatedAt = Instant.EPOCH)
        override fun list() = listOf(project)
        override fun get(id: String) = project.takeIf { id == PROJECT_ID }
        override fun create(name: String, storePath: String) = error("unused")
        override fun update(id: String, command: UpdateProjectCommand) = error("unused")
        override fun delete(id: String) = false
    }

    private class MemoryRepositoryStore : RepositoryStore {
        val repositories = mutableListOf<RepositoryLink>()
        private val operations = linkedMapOf<String, CloneOperation>()
        private val events = mutableListOf<OperationEvent>()
        private val sequence = AtomicLong()

        @Synchronized override fun listRepositories(projectId: String) = repositories.filter { it.projectId == projectId }
        @Synchronized override fun createRepository(item: RepositoryLink): RepositoryLink = item.copy(
            id = UUID.randomUUID().toString(), createdAt = Instant.now(), updatedAt = Instant.now(),
        ).also(repositories::add)
        @Synchronized override fun updateRepository(item: RepositoryLink): RepositoryLink? = item.copy(updatedAt = Instant.now()).also { updated ->
            val index = repositories.indexOfFirst { it.id == item.id }
            if (index >= 0) repositories[index] = updated
        }
        @Synchronized override fun createOperation(item: CloneOperation): CloneOperation = item.copy(
            id = UUID.randomUUID().toString(), createdAt = Instant.now(), updatedAt = Instant.now(),
        ).also { operations[it.id] = it }
        @Synchronized override fun getOperation(id: String) = operations[id]
        @Synchronized override fun updateOperation(item: CloneOperation): CloneOperation? = item.copy(updatedAt = Instant.now())
            .also { operations[it.id] = it }
        @Synchronized override fun hasActiveOperation(projectId: String, kind: String) = operations.values.any {
            it.projectId == projectId && it.kind == kind && !it.terminal()
        }
        @Synchronized override fun addEvent(operationId: String, type: String, payload: String): OperationEvent =
            OperationEvent(sequence.incrementAndGet(), operationId, type, payload, Instant.now()).also(events::add)
        @Synchronized override fun listEvents(operationId: String, after: Long) =
            events.filter { it.operationId == operationId && it.sequence > after }
    }

    private companion object {
        const val PROJECT_ID = "project-1"
    }
}
