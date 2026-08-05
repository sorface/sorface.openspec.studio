package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.domain.project.ContextImportSummary
import com.sorface.openspecstudio.domain.project.CreateProjectCommand
import com.sorface.openspecstudio.domain.project.CreateProjectFromGitCommand
import com.sorface.openspecstudio.domain.project.Project
import com.sorface.openspecstudio.domain.project.ProjectException
import com.sorface.openspecstudio.domain.project.UpdateProjectCommand
import com.sorface.openspecstudio.infrastructure.project.ContextManifestReader
import org.springframework.beans.factory.ObjectProvider
import org.springframework.stereotype.Service

/** Оркестрирует project CRUD, Store initialization и context import. */
@Service
internal class ProjectService(
    private val repository: ProjectRepository,
    private val stores: StoreManager,
    private val manifests: ContextManifestReader,
    importers: ObjectProvider<ContextImporter>,
) {
    private val importer = importers.ifAvailable

    fun list(): List<Project> = repository.list()

    fun get(id: String): Project = repository.get(id) ?: notFound()

    fun create(command: CreateProjectCommand): Project {
        val name = requiredName(command.name)
        val storePath = stores.validate(command.storePath.trim())
        return repository.create(name, storePath)
    }

    fun createFromGit(command: CreateProjectFromGitCommand): Project {
        val storePath = stores.clone(command.url.trim())
        val manifestResult = manifests.read(storePath)
        val name = requiredName(manifestResult.manifest?.name ?: command.name)
        val remotes = manifestResult.manifest?.repositories.orEmpty()
        val normalized = if (remotes.isEmpty()) emptyList() else
            (importer ?: throw ProjectException("GIT_UNAVAILABLE", "Git недоступен")).validateRepositories(remotes)
        var created = repository.create(name, storePath)
        if (manifestResult.found) {
            val imported = if (normalized.isEmpty()) {
                ContextImportSummary(true, 0, 0, emptyList())
            } else {
                val result = importer!!.import(created, normalized)
                result.copy(manifestFound = true, requested = normalized.size)
            }
            created = created.copy(contextImport = imported)
        }
        return created
    }

    fun update(id: String, command: UpdateProjectCommand): Project {
        val normalized = command.copy(name = command.name?.let(::requiredName))
        return repository.update(id, normalized) ?: notFound()
    }

    fun delete(id: String) {
        if (!repository.delete(id)) notFound()
    }

    private fun requiredName(value: String?): String = value?.trim()?.takeIf(String::isNotEmpty)
        ?: throw ProjectException("INVALID_PROJECT_NAME", "Название проекта обязательно")

    private fun notFound(): Nothing = throw ProjectException("PROJECT_NOT_FOUND", "Проект не найден")
}
