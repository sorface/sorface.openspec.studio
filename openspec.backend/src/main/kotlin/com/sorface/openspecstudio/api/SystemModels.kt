package com.sorface.openspecstudio.api

/** Состояние готовности локального backend. */
data class HealthResponse(val status: String = "ready", val service: String = "openspec-studio")

/** Данные сессии браузера. */
data class SessionResponse(val csrfToken: String)

/** Обнаруженный локальный инструмент. */
data class ToolCapability(
    val name: String,
    val available: Boolean,
    val path: String? = null,
    val version: String? = null,
    val supported: Boolean? = null,
    val nonInteractive: Boolean? = null,
    val models: List<String>? = null,
)

/** Возможности текущей операционной системы. */
data class SystemCapabilities(val os: String, val arch: String, val tools: List<ToolCapability>)
