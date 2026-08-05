package com.sorface.openspecstudio.domain.repository

import com.fasterxml.jackson.annotation.JsonIgnore
import java.time.Instant

data class RepositoryLink(
    val id: String,
    val projectId: String,
    val name: String,
    val path: String,
    val remoteUrl: String,
    val fingerprint: String,
    val branch: String = "",
    val commitSha: String,
    val dirty: Boolean,
    val available: Boolean = true,
    val readOnlyForAi: Boolean = true,
    val upstream: String = "",
    val ahead: Int = 0,
    val behind: Int = 0,
    val localBranches: List<String> = emptyList(),
    val remoteBranches: List<String> = emptyList(),
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class CloneOperation(
    val id: String,
    val projectId: String,
    val kind: String = "repository_clone",
    val status: String,
    val errorCode: String = "",
    val errorMessage: String = "",
    val correlationId: String = "",
    val provider: String = "",
    val model: String = "",
    val prompt: String = "",
    val result: String = "",
    val openspecAction: String = "",
    val openspecChange: String = "",
    val openspecSchema: String = "",
    val openspecArtifact: String = "",
    val openspecFingerprint: String = "",
    val gitAction: String = "",
    val gitRemote: String = "",
    val gitBranch: String = "",
    @get:JsonIgnore val inputJson: String = "{}",
    val createdAt: Instant,
    val updatedAt: Instant,
) {
    fun terminal(): Boolean = status in TERMINAL_STATUSES

    private companion object {
        val TERMINAL_STATUSES = setOf("completed", "awaiting_review", "accepted", "rejected", "cancelled", "failed")
    }
}

data class OperationEvent(
    val sequence: Long,
    val operationId: String,
    val type: String,
    val payload: String,
    val createdAt: Instant,
)

data class CloneRepositoryCommand(val url: String)
data class SwitchRepositoryBranchCommand(val branch: String, val remote: Boolean = false)

/** Ошибка repository use case со стабильным API-кодом. */
class RepositoryException(val code: String, override val message: String) : RuntimeException(message)
