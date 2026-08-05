package com.sorface.openspecstudio.api

/** Публичное описание ошибки API. */
data class ApiError(
    val code: String,
    val message: String,
    val details: Any? = null,
    val correlationId: String,
)

/** Envelope ошибки, ожидаемый frontend. */
data class ApiErrorEnvelope(val error: ApiError)
