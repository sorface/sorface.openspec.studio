package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.config.LocalServerProperties
import com.sorface.openspecstudio.domain.project.Project
import com.sorface.openspecstudio.domain.project.UpdateProjectCommand
import com.sorface.openspecstudio.domain.taskcontext.OpenTaskWorkspaceCommand
import com.sorface.openspecstudio.domain.taskcontext.TaskContextException
import com.sorface.openspecstudio.domain.taskcontext.TaskWorkspace
import com.sorface.openspecstudio.infrastructure.process.SafeProcessRunner
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.springframework.beans.factory.support.StaticListableBeanFactory
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant
import java.util.UUID

@DisplayName("Task workspace на реальных Git worktree")
class TaskWorkspaceServiceIT {
    @TempDir lateinit var root: Path
    private lateinit var base: Path
    private lateinit var seed: Path
    private lateinit var remote: Path
    private lateinit var service: TaskWorkspaceService
    private lateinit var state: State

    @BeforeEach
    fun prepare() {
        remote = root.resolve("remote.git")
        seed = root.resolve("seed")
        base = root.resolve("base")
        git(root, "init", "--bare", remote.toString())
        git(root, "init", "-b", "main", seed.toString())
        configure(seed)
        Files.createDirectories(seed.resolve("openspec"))
        Files.writeString(seed.resolve("openspec/README.md"), "initial\n")
        git(seed, "add", ".")
        git(seed, "commit", "-m", "docs: initial")
        git(seed, "remote", "add", "origin", remote.toString())
        git(seed, "push", "-u", "origin", "main")
        git(root, "clone", remote.toString(), base.toString())
        configure(base)
        state = State(base)
        val runner = SafeProcessRunner(StaticListableBeanFactory().getBeanProvider(ProcessAuditSink::class.java))
        service = TaskWorkspaceService(state, state, runner,
            LocalServerProperties(dataDir = root.resolve("data"), noBrowser = true))
    }

    @Test
    @DisplayName("создаёт base workspace и изолированный task worktree")
    fun opensWorkspace() {
        val initial = service.list(PROJECT_ID)
        assertThat(initial.active?.branch).isEqualTo("main")
        assertThat(initial.availableBranches).contains("main")

        val opened = service.open(PROJECT_ID, OpenTaskWorkspaceCommand(branch = "feature/CGA-1"))
        assertThat(opened.active?.branch).isEqualTo("feature/CGA-1")
        assertThat(opened.active?.managed).isTrue()
        assertThat(Path.of(state.project.storePath)).isDirectory()
        assertThat(gitOutput(Path.of(state.project.storePath), "rev-parse", "--git-common-dir")).isNotBlank()
    }

    @Test
    @DisplayName("синхронизирует активную upstream ветку fast-forward")
    fun syncsWorkspace() {
        service.list(PROJECT_ID)
        Files.writeString(seed.resolve("openspec/README.md"), "remote\n")
        git(seed, "add", ".")
        git(seed, "commit", "-m", "docs: remote")
        git(seed, "push", "origin", "main")

        val result = service.sync(PROJECT_ID)

        assertThat(result.task).isEqualTo("main")
        assertThat(result.updated).isTrue()
        assertThat(result.head).isNotEqualTo(result.previousHead)
        assertThat(Files.readString(base.resolve("openspec/README.md"))).isEqualTo("remote\n")
    }

    @Test
    @DisplayName("отклоняет неоднозначную и отсутствующую remote branch")
    fun rejectsBranches() {
        assertThatThrownBy { service.open(PROJECT_ID, OpenTaskWorkspaceCommand()) }
            .isInstanceOf(TaskContextException::class.java).extracting("code").isEqualTo("TASK_BRANCH_INVALID")
        assertThatThrownBy { service.open(PROJECT_ID, OpenTaskWorkspaceCommand(remoteBranch = "origin/missing")) }
            .isInstanceOf(TaskContextException::class.java).extracting("code").isEqualTo("TASK_REMOTE_BRANCH_NOT_FOUND")
    }

    private fun configure(path: Path) {
        git(path, "config", "user.name", "Task Test")
        git(path, "config", "user.email", "task@example.test")
    }
    private fun git(directory: Path, vararg args: String) { gitOutput(directory, *args) }
    private fun gitOutput(directory: Path, vararg args: String): String {
        val process = ProcessBuilder(listOf("git", "-C", directory.toString()) + args).redirectErrorStream(true).start()
        val output = process.inputStream.bufferedReader().readText().trim()
        check(process.waitFor() == 0) { output }
        return output
    }

    private class State(path: Path) : ProjectRepository, TaskWorkspaceRepository {
        var project = Project(PROJECT_ID, "Tasks", path.toString(), createdAt = Instant.EPOCH, updatedAt = Instant.EPOCH)
        private val items = mutableListOf<TaskWorkspace>()
        override fun list() = listOf(project)
        override fun get(id: String) = project.takeIf { id == PROJECT_ID }
        override fun create(name: String, storePath: String) = error("unused")
        override fun update(id: String, command: UpdateProjectCommand) = error("unused")
        override fun delete(id: String) = false
        override fun create(item: TaskWorkspace) = item.copy(id = item.id.ifBlank { UUID.randomUUID().toString() }, createdAt = Instant.now(), updatedAt = Instant.now()).also(items::add)
        override fun list(projectId: String) = items.filter { it.projectId == projectId }.map { it.copy(active = it.id == project.activeWorktreeId) }
        override fun findByBranch(projectId: String, branch: String) = list(projectId).firstOrNull { it.branch == branch }
        override fun activate(projectId: String, workspaceId: String): Boolean {
            val selected = items.firstOrNull { it.projectId == projectId && it.id == workspaceId } ?: return false
            project = project.copy(activeWorktreeId = workspaceId, activeTask = selected.branch, storePath = selected.path)
            return true
        }
    }
    private companion object { const val PROJECT_ID = "task-project" }
}
