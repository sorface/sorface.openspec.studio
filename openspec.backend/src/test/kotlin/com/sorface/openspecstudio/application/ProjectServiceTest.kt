package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.domain.project.ContextImportSummary
import com.sorface.openspecstudio.domain.project.CreateProjectCommand
import com.sorface.openspecstudio.domain.project.CreateProjectFromGitCommand
import com.sorface.openspecstudio.domain.project.Project
import com.sorface.openspecstudio.domain.project.ProjectException
import com.sorface.openspecstudio.domain.project.UpdateProjectCommand
import com.sorface.openspecstudio.infrastructure.project.ContextManifestReader
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.springframework.beans.factory.support.StaticListableBeanFactory
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant

@DisplayName("Project use cases")
class ProjectServiceTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    @DisplayName("нормализует имя и проверяет Store перед созданием")
    fun createsValidatedProject() {
        val repository = MemoryProjectRepository()
        val service = service(repository, FakeStoreManager("/canonical/store"))

        val created = service.create(CreateProjectCommand(" Platform ", " /input "))

        assertThat(created.name).isEqualTo("Platform")
        assertThat(created.storePath).isEqualTo("/canonical/store")
    }

    @Test
    @DisplayName("использует manifest name и импортирует уникальный context")
    fun createsFromGitManifest() {
        Files.createDirectories(tempDir.resolve(".openspec"))
        Files.writeString(
            tempDir.resolve(".openspec/context.yaml"),
            """
            name: manifest-project
            context:
              repositories:
                - git@example.com:team/one.git
                - git@example.com:team/one.git
            """.trimIndent(),
        )
        val importer = FakeContextImporter()
        val service = service(MemoryProjectRepository(), FakeStoreManager(tempDir.toString()), importer)

        val created = service.createFromGit(CreateProjectFromGitCommand("fallback", "git@example.com:team/store.git"))

        assertThat(created.name).isEqualTo("manifest-project")
        assertThat(created.contextImport).isEqualTo(ContextImportSummary(true, 1, 1, emptyList()))
        assertThat(importer.imported).containsExactly("git@example.com:team/one.git")
    }

    @Test
    @DisplayName("возвращает стабильные ошибки validation и not found")
    fun rejectsInvalidCommands() {
        val service = service(MemoryProjectRepository(), FakeStoreManager("/store"))

        assertThatThrownBy { service.create(CreateProjectCommand(" ", "/store")) }
            .isInstanceOf(ProjectException::class.java)
            .extracting("code").isEqualTo("INVALID_PROJECT_NAME")
        assertThatThrownBy { service.get("missing") }
            .isInstanceOf(ProjectException::class.java)
            .extracting("code").isEqualTo("PROJECT_NOT_FOUND")
    }

    private fun service(
        repository: ProjectRepository,
        stores: StoreManager,
        importer: ContextImporter? = null,
    ): ProjectService {
        val beans = StaticListableBeanFactory()
        if (importer != null) beans.addBean("contextImporter", importer)
        return ProjectService(repository, stores, ContextManifestReader(), beans.getBeanProvider(ContextImporter::class.java))
    }

    private class FakeStoreManager(private val path: String) : StoreManager {
        override fun validate(path: String): String = this.path
        override fun clone(remote: String): String = path
    }

    private class FakeContextImporter : ContextImporter {
        var imported: List<String> = emptyList()

        override fun validateRepositories(remotes: List<String>): List<String> = remotes.distinct()
        override fun import(project: Project, remotes: List<String>): ContextImportSummary {
            imported = remotes
            return ContextImportSummary(false, 0, remotes.size, emptyList())
        }
    }

    private class MemoryProjectRepository : ProjectRepository {
        private val items = linkedMapOf<String, Project>()

        override fun list(): List<Project> = items.values.toList()
        override fun get(id: String): Project? = items[id]
        override fun create(name: String, storePath: String): Project = Project(
            id = "project-${items.size + 1}",
            name = name,
            storePath = storePath,
            createdAt = Instant.EPOCH,
            updatedAt = Instant.EPOCH,
        ).also { items[it.id] = it }

        override fun update(id: String, command: UpdateProjectCommand): Project? = items[id]?.copy(
            name = command.name ?: items.getValue(id).name,
            defaultAiProvider = command.defaultAiProvider,
            defaultModel = command.defaultModel,
        )?.also { items[id] = it }

        override fun delete(id: String): Boolean = items.remove(id) != null
    }
}
