package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.api.SystemCapabilities

/** Предоставляет единый CSRF-токен текущего процесса приложения. */
fun interface CsrfTokenProvider {
    /** Возвращает неизменяемый токен текущего процесса. */
    fun token(): String
}

/** Обнаруживает доступные локальные инструменты и платформу. */
fun interface CapabilitiesProvider {
    /** Возвращает снимок платформы и доступных CLI-инструментов. */
    fun detect(): SystemCapabilities
}
