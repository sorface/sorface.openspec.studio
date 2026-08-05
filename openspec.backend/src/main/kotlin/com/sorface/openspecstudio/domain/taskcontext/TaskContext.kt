package com.sorface.openspecstudio.domain.taskcontext

import com.fasterxml.jackson.annotation.JsonIgnore
import com.sorface.openspecstudio.domain.git.GitOperation
import java.time.Instant

data class TaskWorkspace(
    val id: String,
    @get:JsonIgnore val projectId: String,
    val branch: String,
    @get:JsonIgnore val path: String,
    val managed: Boolean,
    val active: Boolean = false,
    val dirty: Boolean = false,
    val createdAt: Instant,
    val updatedAt: Instant,
)
data class TaskWorkspaceOverview(val items: List<TaskWorkspace>, val availableBranches: List<String>,
    val remoteBranches: List<String>, val active: TaskWorkspace? = null)
data class OpenTaskWorkspaceCommand(val branch: String = "", val remoteBranch: String = "")
data class TaskSyncResult(val task: String, val updated: Boolean, val previousHead: String, val head: String)

data class PublicationPreview(
    val token: String,
    val task: String,
    val paths: List<String>,
    val excludedCount: Int,
    val message: String,
    val body: String = "",
    val generatedBy: String = "manual",
    val diffTruncated: Boolean,
    val expiresAt: Instant,
)

data class GeneratePublicationMessageCommand(val token: String)
data class ConfirmPublicationCommand(val token: String, val message: String = "", val body: String = "")
data class PublicationResult(val task: String, val commitSha: String, val operation: GitOperation)
data class PublicationMessageRequest(
    val task: String, val paths: List<String>, val diff: String, val provider: String, val model: String,
)
data class GeneratedCommitMessage(val subject: String, val body: String)

class TaskContextException(val code: String, override val message: String) : RuntimeException(message)
