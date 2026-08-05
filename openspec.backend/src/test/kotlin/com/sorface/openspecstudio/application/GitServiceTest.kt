package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.domain.git.GitCommitCommand
import com.sorface.openspecstudio.domain.git.GitException
import com.sorface.openspecstudio.domain.git.GitPathsCommand
import com.sorface.openspecstudio.domain.project.Project
import com.sorface.openspecstudio.domain.project.UpdateProjectCommand
import com.sorface.openspecstudio.domain.repository.CloneOperation
import com.sorface.openspecstudio.domain.repository.OperationEvent
import com.sorface.openspecstudio.domain.repository.RepositoryLink
import com.sorface.openspecstudio.infrastructure.process.ProcessSupervisor
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import tools.jackson.databind.ObjectMapper
import java.nio.file.Path
import java.time.Instant

@DisplayName("Store Git use case guards")
class GitServiceTest {
    @TempDir lateinit var storePath: Path

    @Test
    fun `отклоняет пустой selection стабильным кодом`() {
        assertThatThrownBy { service().stage(PROJECT_ID, GitPathsCommand(emptyList())) }
            .isInstanceOf(GitException::class.java)
            .extracting("code").isEqualTo("GIT_EMPTY_SELECTION")
    }

    @Test
    fun `не позволяет selection выйти за Store`() {
        assertThatThrownBy { service().stage(PROJECT_ID, GitPathsCommand(listOf("../secret"))) }
            .isInstanceOf(GitException::class.java)
            .extracting("code").isEqualTo("INVALID_STORE_PATH")
    }

    @Test
    fun `проверяет conventional commit до изменения Git index`() {
        assertThatThrownBy {
            service().commit(PROJECT_ID, GitCommitCommand(listOf("README.md"), "обычное сообщение", "head"))
        }.isInstanceOf(GitException::class.java)
            .extracting("code").isEqualTo("GIT_INVALID_COMMIT_MESSAGE")
    }

    private fun service() = GitService(
        FixedProjectRepository(storePath),
        object : StoreManager {
            override fun validate(path: String) = storePath.toRealPath().toString()
            override fun clone(remote: String) = error("unused")
        },
        EmptyRepositoryStore,
        ProcessRunner { _, _ -> error("Git must not run for rejected input") },
        ProcessSupervisor(),
        ObjectMapper(),
    )

    private class FixedProjectRepository(storePath: Path) : ProjectRepository {
        private val project = Project(PROJECT_ID, "Test", storePath.toString(), createdAt = Instant.EPOCH, updatedAt = Instant.EPOCH)
        override fun list() = listOf(project)
        override fun get(id: String) = project.takeIf { id == PROJECT_ID }
        override fun create(name: String, storePath: String) = error("unused")
        override fun update(id: String, command: UpdateProjectCommand) = error("unused")
        override fun delete(id: String) = false
    }

    private object EmptyRepositoryStore : RepositoryStore {
        override fun listRepositories(projectId: String): List<RepositoryLink> = emptyList()
        override fun createRepository(item: RepositoryLink) = error("unused")
        override fun updateRepository(item: RepositoryLink) = error("unused")
        override fun createOperation(item: CloneOperation) = error("unused")
        override fun getOperation(id: String): CloneOperation? = null
        override fun updateOperation(item: CloneOperation) = error("unused")
        override fun hasActiveOperation(projectId: String, kind: String) = false
        override fun addEvent(operationId: String, type: String, payload: String) = error("unused")
        override fun listEvents(operationId: String, after: Long): List<OperationEvent> = emptyList()
    }

    private companion object {
        const val PROJECT_ID = "project-1"
    }
}
