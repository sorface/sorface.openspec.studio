package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.domain.openspec.ChangeCreationDraft
import com.sorface.openspecstudio.domain.openspec.FileMutation
import com.sorface.openspecstudio.domain.openspec.Instructions
import com.sorface.openspecstudio.domain.openspec.ExplorationResult
import com.sorface.openspecstudio.domain.repository.CloneOperation
import com.sorface.openspecstudio.domain.openspec.DraftSet
import java.nio.file.Path

interface ChangeCreationDraftRepository {
    fun get(projectId: String): ChangeCreationDraft?
    fun save(draft: ChangeCreationDraft): ChangeCreationDraft
    fun delete(projectId: String): Boolean
}

interface OpenSpecOperationStore {
    fun list(projectId:String,change:String):List<CloneOperation>
    fun saveDraft(set:DraftSet):DraftSet
    fun getDraft(id:String):DraftSet?
    fun getDraftByOperation(operationId:String):DraftSet?
    fun updateDraftStatus(id:String,status:String):DraftSet?
}

/** Исследует пользовательский замысел без изменения OpenSpec Store. */
fun interface OpenSpecExplorer {
    /** Возвращает строго проверенный результат уточнения или готовый proposal. */
    fun explore(request: OpenSpecExplorationRequest, cancellation: ProcessCancellation): ExplorationResult

    companion object {
        val UNAVAILABLE = OpenSpecExplorer { _, _ ->
            throw com.sorface.openspecstudio.domain.openspec.OpenSpecException(
                "OPENSPEC_PROVIDER_UNAVAILABLE", "AI provider недоступен",
            )
        }
    }
}

data class OpenSpecExplorationRequest(
    val operationId: String,
    val root: Path,
    val goal: String,
    val provider: String,
    val model: String,
    val onProgress: (String) -> Unit = {},
)

/** Запускает Agent CLI в изолированной копии OpenSpec Store. */
fun interface OpenSpecArtifactGenerator {
    /** Подготавливает изменения артефакта, не изменяя исходный Store. */
    fun generate(request: OpenSpecArtifactGenerationRequest, cancellation: ProcessCancellation): OpenSpecArtifactGenerationResult

    companion object {
        val UNAVAILABLE = OpenSpecArtifactGenerator { _, _ ->
            throw com.sorface.openspecstudio.domain.openspec.OpenSpecException(
                "OPENSPEC_PROVIDER_UNAVAILABLE", "AI provider недоступен",
            )
        }
    }
}

data class OpenSpecArtifactGenerationRequest(
    val operationId: String,
    val root: Path,
    val change: String,
    val artifact: String,
    val goal: String,
    val provider: String,
    val model: String,
    val instructions: Instructions,
    val onProgress: (String) -> Unit = {},
)

data class OpenSpecArtifactGenerationResult(
    val finalResponse: String,
    val files: List<FileMutation>,
)
