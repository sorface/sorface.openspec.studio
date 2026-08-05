package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.config.LocalServerProperties
import com.sorface.openspecstudio.domain.project.Project
import com.sorface.openspecstudio.domain.project.UpdateProjectCommand
import com.sorface.openspecstudio.domain.repository.CloneOperation
import com.sorface.openspecstudio.domain.repository.OperationEvent
import com.sorface.openspecstudio.domain.repository.RepositoryLink
import com.sorface.openspecstudio.domain.repository.SwitchRepositoryBranchCommand
import com.sorface.openspecstudio.infrastructure.process.ProcessSupervisor
import com.sorface.openspecstudio.infrastructure.process.SafeProcessRunner
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.springframework.beans.factory.support.StaticListableBeanFactory
import tools.jackson.databind.ObjectMapper
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant

@DisplayName("Repository service на реальном Git")
class RepositoryGitIT {
    @TempDir lateinit var root: Path

    @Test
    fun `инспектирует remote branch переключает её и выполняет fetch update`() {
        val dataDir = root.resolve("data")
        val remote = root.resolve("remote.git")
        val seed = root.resolve("seed")
        git(root, "init", "--bare", remote.toString())
        git(root, "init", "-b", "main", seed.toString())
        git(seed, "config", "user.name", "Integration Test")
        git(seed, "config", "user.email", "test@example.test")
        Files.writeString(seed.resolve("README.md"), "main\n")
        git(seed, "add", "README.md")
        git(seed, "commit", "-m", "main")
        git(seed, "branch", "feature")
        git(seed, "remote", "add", "origin", remote.toString())
        git(seed, "push", "-u", "origin", "main", "feature")
        val target = dataDir.resolve("projects/$PROJECT_ID/repositories/code")
        Files.createDirectories(target.parent)
        git(target.parent, "clone", remote.toString(), target.toString())
        git(target, "switch", "main")
        val store = MemoryStore(
            RepositoryLink(
                "repository-1", PROJECT_ID, "code", target.toString(), "ssh://git@example.test/team/code.git",
                "initial", commitSha = "", dirty = false, createdAt = Instant.EPOCH, updatedAt = Instant.EPOCH,
            ),
        )
        val runner = SafeProcessRunner(StaticListableBeanFactory().getBeanProvider(ProcessAuditSink::class.java))
        val service = RepositoryService(
            FixedProjectRepository(), store, runner, ProcessSupervisor(), ObjectMapper(),
            LocalServerProperties(dataDir = dataDir, noBrowser = true),
        )

        val inspected = service.list(PROJECT_ID).single()
        val switched = service.switchBranch(
            PROJECT_ID,
            inspected.id,
            SwitchRepositoryBranchCommand("origin/feature", remote = true),
        )
        val updated = service.update(PROJECT_ID, inspected.id)

        assertThat(inspected.remoteBranches).contains("origin/feature")
        assertThat(switched.branch).isEqualTo("feature")
        assertThat(updated.upstream).isEqualTo("origin/feature")
        assertThat(updated.dirty).isFalse()
    }

    private fun git(directory: Path, vararg arguments: String) {
        val process = ProcessBuilder(listOf("git", "-C", directory.toString()) + arguments).redirectErrorStream(true).start()
        val output = process.inputStream.bufferedReader().readText()
        check(process.waitFor() == 0) { output }
    }

    private class FixedProjectRepository : ProjectRepository {
        private val project = Project(PROJECT_ID, "Git", "/store", createdAt = Instant.EPOCH, updatedAt = Instant.EPOCH)
        override fun list() = listOf(project)
        override fun get(id: String) = project.takeIf { id == PROJECT_ID }
        override fun create(name: String, storePath: String) = error("unused")
        override fun update(id: String, command: UpdateProjectCommand) = error("unused")
        override fun delete(id: String) = false
    }

    private class MemoryStore(item: RepositoryLink) : RepositoryStore {
        private var repository = item
        override fun listRepositories(projectId: String) = listOf(repository).filter { it.projectId == projectId }
        override fun createRepository(item: RepositoryLink) = error("unused")
        override fun updateRepository(item: RepositoryLink): RepositoryLink = item.also { repository = it }
        override fun createOperation(item: CloneOperation) = error("unused")
        override fun getOperation(id: String): CloneOperation? = null
        override fun updateOperation(item: CloneOperation): CloneOperation? = null
        override fun hasActiveOperation(projectId: String, kind: String) = false
        override fun addEvent(operationId: String, type: String, payload: String) = error("unused")
        override fun listEvents(operationId: String, after: Long): List<OperationEvent> = emptyList()
    }

    private companion object {
        const val PROJECT_ID = "project-git"
    }
}
