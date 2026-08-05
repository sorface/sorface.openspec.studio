package com.sorface.openspecstudio.domain.ai

import java.time.Instant

data class ContextIntent(val source: String, val path: String)
data class ContextManifestCommand(val files: List<ContextIntent> = emptyList())
data class ContextEntry(
    val source: String,
    val path: String,
    val size: Long = 0,
    val checksum: String = "",
    val reason: String,
    val included: Boolean,
)
data class ContextManifest(
    val reviewToken: String,
    val entries: List<ContextEntry>,
    val expiresAt: Instant,
    val limits: Map<String, Long>,
)
data class CreateAiOperationCommand(
    val reviewToken: String,
    val prompt: String,
    val provider: String,
    val model: String = "",
    val reasoningEffort: String = "",
)
data class AiFileDiff(val path: String, val before: String, val after: String)
data class AiResult(val finalResponse: String, val files: List<AiFileDiff>)

class AiException(val code: String, override val message: String) : RuntimeException(message)
