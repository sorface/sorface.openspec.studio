package com.sorface.openspecstudio.domain.project

import com.fasterxml.jackson.annotation.JsonIgnore
import java.time.Instant

/** Локальный OpenSpec Store и выбранный task worktree. */
data class Project(
    val id: String,
    val name: String,
    val storePath: String,
    @get:JsonIgnore val baseStorePath: String = storePath,
    val activeWorktreeId: String? = null,
    val activeTask: String? = null,
    val defaultAiProvider: String? = null,
    val defaultModel: String? = null,
    val contextImport: ContextImportSummary? = null,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class CreateProjectCommand(val name: String, val storePath: String)
data class CreateProjectFromGitCommand(val name: String = "", val url: String)
data class UpdateProjectCommand(
    val name: String? = null,
    val defaultAiProvider: String? = null,
    val defaultModel: String? = null,
)
data class ContextImportFailure(val url: String, val code: String, val message: String)
data class ContextImportSummary(
    val manifestFound: Boolean,
    val requested: Int,
    val imported: Int,
    val failures: List<ContextImportFailure>,
)

data class ContextManifest(val name: String, val repositories: List<String>)

/** Ошибка project use case с публичным API-кодом. */
class ProjectException(val code: String, override val message: String) : RuntimeException(message)
