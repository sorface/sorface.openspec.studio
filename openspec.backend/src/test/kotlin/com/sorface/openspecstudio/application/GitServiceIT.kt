package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.domain.git.GitCommitCommand
import com.sorface.openspecstudio.domain.git.GitCreateBranchCommand
import com.sorface.openspecstudio.domain.git.GitException
import com.sorface.openspecstudio.domain.git.GitFetchCommand
import com.sorface.openspecstudio.domain.git.GitPathsCommand
import com.sorface.openspecstudio.domain.git.GitPushCommand
import com.sorface.openspecstudio.domain.git.GitSwitchBranchCommand
import com.sorface.openspecstudio.domain.project.Project
import com.sorface.openspecstudio.domain.project.UpdateProjectCommand
import com.sorface.openspecstudio.domain.repository.CloneOperation
import com.sorface.openspecstudio.domain.repository.OperationEvent
import com.sorface.openspecstudio.domain.repository.RepositoryLink
import com.sorface.openspecstudio.infrastructure.process.ProcessSupervisor
import com.sorface.openspecstudio.infrastructure.process.SafeProcessRunner
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.springframework.beans.factory.support.StaticListableBeanFactory
import tools.jackson.databind.ObjectMapper
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong

@DisplayName("Git service на временных репозиториях")
class GitServiceIT {
    @TempDir lateinit var root: Path
    private lateinit var working: Path
    private lateinit var remote: Path
    private lateinit var service: GitService
    private lateinit var store: MemoryStore

    @BeforeEach
    fun prepare() {
        working = root.resolve("store")
        remote = root.resolve("remote.git")
        git(root, "init", "--bare", remote.toString())
        git(root, "init", "-b", "main", working.toString())
        git(working, "config", "user.name", "Git Test")
        git(working, "config", "user.email", "git@example.test")
        Files.writeString(working.resolve("proposal.md"), "first\n")
        git(working, "add", "proposal.md")
        git(working, "commit", "-m", "feat: initial")
        git(working, "remote", "add", "origin", remote.toString())
        git(working, "push", "-u", "origin", "main")
        store = MemoryStore()
        val runner = SafeProcessRunner(StaticListableBeanFactory().getBeanProvider(ProcessAuditSink::class.java))
        service = GitService(FixedProjects(working), FixedStoreManager(working), store, runner, ProcessSupervisor(), ObjectMapper())
    }

    @Test
    @DisplayName("показывает status, stage, commit и управляет ветками")
    fun localWorkflow() {
        val initial = service.status(PROJECT_ID)
        assertThat(initial.branch).isEqualTo("main")
        assertThat(initial.remotes).containsExactly("origin")

        Files.writeString(working.resolve("proposal.md"), "second\n")
        assertThat(service.status(PROJECT_ID).changes).singleElement().extracting("path").isEqualTo("proposal.md")
        val staged = service.stage(PROJECT_ID, GitPathsCommand(listOf("proposal.md")))
        assertThat(staged.diff).contains("# Staged", "+second")
        val committed = service.commit(PROJECT_ID, GitCommitCommand(listOf("proposal.md"), "docs: update proposal", staged.head))
        assertThat(committed.changes).isEmpty()

        assertThat(service.createBranch(PROJECT_ID, GitCreateBranchCommand("feature/test")).branch).isEqualTo("feature/test")
        assertThat(service.switchBranch(PROJECT_ID, GitSwitchBranchCommand(branch = "main")).branch).isEqualTo("main")
    }

    @Test
    @DisplayName("выполняет асинхронные fetch и push с событиями")
    fun remoteWorkflow() {
        val fetch = service.startFetch(PROJECT_ID, GitFetchCommand("origin"), "fetch-correlation")
        val completedFetch = await(fetch.id)
        assertThat(completedFetch.status).isEqualTo("completed")
        assertThat(service.events(PROJECT_ID, fetch.id, 0).map { it.type }).containsExactly("queued", "running", "completed")

        Files.writeString(working.resolve("tasks.md"), "task\n")
        git(working, "add", "tasks.md")
        git(working, "commit", "-m", "docs: add tasks")
        val push = service.startPush(PROJECT_ID, GitPushCommand(), "push-correlation")
        assertThat(await(push.id).status).isEqualTo("completed")
        assertThat(gitOutput(root, "--git-dir", remote.toString(), "rev-parse", "refs/heads/main")).isEqualTo(service.status(PROJECT_ID).head)
    }

    @Test
    @DisplayName("отклоняет небезопасные пути, сообщения и dirty branch switch")
    fun rejectsUnsafeInputs() {
        assertThatThrownBy { service.stage(PROJECT_ID, GitPathsCommand(listOf("../outside"))) }
            .isInstanceOf(GitException::class.java).extracting("code").isEqualTo("INVALID_STORE_PATH")
        assertThatThrownBy { service.commit(PROJECT_ID, GitCommitCommand(listOf("proposal.md"), "plain message", service.status(PROJECT_ID).head)) }
            .isInstanceOf(GitException::class.java).extracting("code").isEqualTo("GIT_INVALID_COMMIT_MESSAGE")
        Files.writeString(working.resolve("proposal.md"), "dirty\n")
        assertThatThrownBy { service.createBranch(PROJECT_ID, GitCreateBranchCommand("feature/blocked")) }
            .isInstanceOf(GitException::class.java).extracting("code").isEqualTo("WORKTREE_DIRTY")
    }

    @Test
    @DisplayName("unstage возвращает изменение в worktree")
    fun unstages() {
        Files.writeString(working.resolve("proposal.md"), "unstaged\n")
        service.stage(PROJECT_ID, GitPathsCommand(listOf("proposal.md")))
        val result = service.unstage(PROJECT_ID, GitPathsCommand(listOf("proposal.md")))
        assertThat(result.changes.single().index).isEqualTo(" ")
        assertThat(result.changes.single().worktree).isEqualTo("M")
    }

    private fun await(id: String): CloneOperation {
        repeat(300) {
            val current = service.operation(PROJECT_ID, id)
            if (current.terminal()) return current
            Thread.sleep(10)
        }
        error("Git operation did not finish")
    }

    private fun git(directory: Path, vararg arguments: String) {
        val process = ProcessBuilder(listOf("git", "-C", directory.toString()) + arguments).redirectErrorStream(true).start()
        val output = process.inputStream.bufferedReader().readText()
        check(process.waitFor() == 0) { output }
    }

    private fun gitOutput(directory: Path, vararg arguments: String): String {
        val process = ProcessBuilder(listOf("git", "-C", directory.toString()) + arguments).redirectErrorStream(true).start()
        val output = process.inputStream.bufferedReader().readText().trim()
        check(process.waitFor() == 0) { output }
        return output
    }

    private class FixedProjects(path: Path) : ProjectRepository {
        private val project = Project(PROJECT_ID, "Git", path.toString(), createdAt = Instant.EPOCH, updatedAt = Instant.EPOCH)
        override fun list() = listOf(project)
        override fun get(id: String) = project.takeIf { id == PROJECT_ID }
        override fun create(name: String, storePath: String) = error("unused")
        override fun update(id: String, command: UpdateProjectCommand) = error("unused")
        override fun delete(id: String) = false
    }

    private class FixedStoreManager(private val path: Path) : StoreManager {
        override fun validate(path: String) = this.path.toRealPath().toString()
        override fun clone(remote: String) = error("unused")
    }

    private class MemoryStore : RepositoryStore {
        private val operations = linkedMapOf<String, CloneOperation>()
        private val events = mutableListOf<OperationEvent>()
        private val sequence = AtomicLong()
        override fun listRepositories(projectId: String): List<RepositoryLink> = emptyList()
        override fun createRepository(item: RepositoryLink) = error("unused")
        override fun updateRepository(item: RepositoryLink): RepositoryLink? = null
        @Synchronized override fun createOperation(item: CloneOperation) = item.copy(id = UUID.randomUUID().toString(), createdAt = Instant.now(), updatedAt = Instant.now()).also { operations[it.id] = it }
        @Synchronized override fun getOperation(id: String) = operations[id]
        @Synchronized override fun updateOperation(item: CloneOperation) = item.copy(updatedAt = Instant.now()).also { operations[it.id] = it }
        @Synchronized override fun hasActiveOperation(projectId: String, kind: String) = operations.values.any { it.projectId == projectId && it.kind == kind && !it.terminal() }
        @Synchronized override fun addEvent(operationId: String, type: String, payload: String) = OperationEvent(sequence.incrementAndGet(), operationId, type, payload, Instant.now()).also(events::add)
        @Synchronized override fun listEvents(operationId: String, after: Long) = events.filter { it.operationId == operationId && it.sequence > after }
    }

    private companion object { const val PROJECT_ID = "git-project" }
}
