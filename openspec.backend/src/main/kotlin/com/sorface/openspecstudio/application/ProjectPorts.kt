package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.domain.project.ContextImportSummary
import com.sorface.openspecstudio.domain.project.CreateProjectCommand
import com.sorface.openspecstudio.domain.project.Project
import com.sorface.openspecstudio.domain.project.UpdateProjectCommand

/** Persistence-граница проектов. */
interface ProjectRepository {
    /** Возвращает проекты от недавно изменённых к старым. */
    fun list(): List<Project>

    /** Находит проект либо возвращает null. */
    fun get(id: String): Project?

    /** Сохраняет новый проект. */
    fun create(name: String, storePath: String): Project

    /** Частично обновляет существующий проект. */
    fun update(id: String, command: UpdateProjectCommand): Project?

    /** Удаляет проект и сообщает, существовал ли он. */
    fun delete(id: String): Boolean
}

/** Управляет основным Git Store проекта. */
interface StoreManager {
    /** Проверяет абсолютный путь и возвращает canonical Git root. */
    fun validate(path: String): String

    /** Клонирует remote в управляемый каталог и возвращает canonical Store. */
    fun clone(remote: String): String
}

/** Импортирует дополнительные repositories из context manifest. */
interface ContextImporter {
    /** Проверяет, нормализует и удаляет дубликаты remote URL. */
    fun validateRepositories(remotes: List<String>): List<String>

    /** Импортирует контекстные repositories и возвращает безопасную сводку. */
    fun import(project: Project, remotes: List<String>): ContextImportSummary
}
