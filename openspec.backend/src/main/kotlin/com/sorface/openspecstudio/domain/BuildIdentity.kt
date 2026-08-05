package com.sorface.openspecstudio.domain

/**
 * Идентифицирует backend и его версию в диагностических ответах.
 *
 * @property name стабильное имя приложения.
 * @property version непустая версия сборки.
 */
data class BuildIdentity(
    val name: String,
    val version: String,
) {
    init {
        require(name.isNotBlank()) { "Имя приложения не должно быть пустым" }
        require(version.isNotBlank()) { "Версия приложения не должна быть пустой" }
    }
}
