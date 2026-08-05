package com.sorface.openspecstudio.runtime

/**
 * Предоставляет устойчивую идентификацию запущенного backend.
 *
 * @author Sorface Developer
 */
interface RuntimeIdentity {
    /** Возвращает сведения о production runtime. */
    fun describe(): RuntimeDescriptor
}

/** Сведения о runtime, которые используются системными endpoints. */
data class RuntimeDescriptor(
    val service: String,
    val language: String,
)
