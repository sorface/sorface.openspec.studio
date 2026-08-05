package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.domain.repository.CloneOperation
import com.sorface.openspecstudio.domain.repository.OperationEvent
import com.sorface.openspecstudio.domain.repository.RepositoryLink
import com.sorface.openspecstudio.domain.ai.ContextEntry

/** Persistence boundary repository links и clone operations. */
interface RepositoryStore {
    /** Возвращает context repositories проекта. */
    fun listRepositories(projectId: String): List<RepositoryLink>
    /** Сохраняет новый context repository. */
    fun createRepository(item: RepositoryLink): RepositoryLink
    /** Обновляет snapshot repository. */
    fun updateRepository(item: RepositoryLink): RepositoryLink?
    /** Создаёт operation. */
    fun createOperation(item: CloneOperation): CloneOperation
    /** Находит operation по id. */
    fun getOperation(id: String): CloneOperation?
    /** Возвращает operations проекта и kind от новых к старым. */
    fun listOperations(projectId: String, kind: String): List<CloneOperation> = emptyList()
    /** Обновляет lifecycle operation. */
    fun updateOperation(item: CloneOperation): CloneOperation?
    /** Проверяет наличие активной operation заданного kind. */
    fun hasActiveOperation(projectId: String, kind: String): Boolean
    /** Добавляет последовательное событие operation. */
    fun addEvent(operationId: String, type: String, payload: String = "{}"): OperationEvent
    /** Читает события после указанной sequence. */
    fun listEvents(operationId: String, after: Long): List<OperationEvent>
    /** Сохраняет подтверждённый context manifest AI operation. */
    fun saveAiContext(operationId: String, entries: List<ContextEntry>) = Unit
}
