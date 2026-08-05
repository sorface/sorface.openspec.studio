package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.config.LocalServerProperties
import com.sorface.openspecstudio.domain.project.Project
import com.sorface.openspecstudio.domain.project.UpdateProjectCommand
import com.sorface.openspecstudio.domain.taskcontext.OpenTaskWorkspaceCommand
import com.sorface.openspecstudio.domain.taskcontext.TaskContextException
import com.sorface.openspecstudio.domain.taskcontext.TaskWorkspace
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.time.Duration
import java.time.Instant

@DisplayName("Task workspace use case guards")
class TaskWorkspaceServiceTest {
    @TempDir lateinit var root: Path

    @Test
    fun `требует ровно одну local или remote ветку`() {
        val service = service { ProcessResult("", "", 0, Duration.ZERO) }
        assertThatThrownBy { service.open(PROJECT_ID, OpenTaskWorkspaceCommand()) }
            .isInstanceOf(TaskContextException::class.java).extracting("code").isEqualTo("TASK_BRANCH_INVALID")
        assertThatThrownBy { service.open(PROJECT_ID, OpenTaskWorkspaceCommand("main", "origin/main")) }
            .isInstanceOf(TaskContextException::class.java).extracting("code").isEqualTo("TASK_BRANCH_INVALID")
    }

    @Test
    fun `отличает отсутствующую remote ветку`() {
        val service = service { command ->
            val found = command.arguments.firstOrNull() != "show-ref"
            ProcessResult("", "", if (found) 0 else 1, Duration.ZERO)
        }
        assertThatThrownBy { service.open(PROJECT_ID, OpenTaskWorkspaceCommand(remoteBranch = "origin/missing")) }
            .isInstanceOf(TaskContextException::class.java).extracting("code").isEqualTo("TASK_REMOTE_BRANCH_NOT_FOUND")
    }

    private fun service(result: (ProcessCommand) -> ProcessResult) = TaskWorkspaceService(
        FixedProjects(root), EmptyWorkspaces, ProcessRunner { command, _ -> result(command) },
        LocalServerProperties(dataDir = root.resolve("data"), noBrowser = true),
    )

    private class FixedProjects(path: Path) : ProjectRepository {
        private val project = Project(PROJECT_ID, "Task", path.toString(), createdAt = Instant.EPOCH, updatedAt = Instant.EPOCH)
        override fun list() = listOf(project)
        override fun get(id: String) = project.takeIf { id == PROJECT_ID }
        override fun create(name: String, storePath: String) = error("unused")
        override fun update(id: String, command: UpdateProjectCommand) = error("unused")
        override fun delete(id: String) = false
    }
    private object EmptyWorkspaces : TaskWorkspaceRepository {
        override fun list(projectId: String): List<TaskWorkspace> = emptyList()
        override fun findByBranch(projectId: String, branch: String): TaskWorkspace? = null
        override fun create(workspace: TaskWorkspace) = error("unused")
        override fun activate(projectId: String, workspaceId: String) = false
    }
    private companion object { const val PROJECT_ID = "project-1" }
}
