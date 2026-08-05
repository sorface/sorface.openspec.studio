package com.sorface.openspecstudio.config

import com.sorface.openspecstudio.api.ApiError
import com.sorface.openspecstudio.api.ApiErrorEnvelope
import com.sorface.openspecstudio.application.CsrfTokenProvider
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.http.MediaType
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import java.net.InetAddress
import java.net.URI
import java.security.SecureRandom
import tools.jackson.databind.ObjectMapper

internal const val CORRELATION_HEADER = "X-Correlation-ID"
private const val CORRELATION_ATTRIBUTE = "openspec.correlationId"

/** Назначает каждому запросу безопасный correlation ID. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
internal class CorrelationIdFilter : OncePerRequestFilter() {
    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, filterChain: FilterChain) {
        val supplied = request.getHeader(CORRELATION_HEADER)
        val id = supplied?.takeIf(CORRELATION_PATTERN::matches) ?: randomToken()
        request.setAttribute(CORRELATION_ATTRIBUTE, id)
        response.setHeader(CORRELATION_HEADER, id)
        filterChain.doFilter(request, response)
    }

    private fun randomToken(): String = ByteArray(24).also(SecureRandom()::nextBytes)
        .joinToString(separator = "") { "%02x".format(it) }

    private companion object {
        val CORRELATION_PATTERN = Regex("[A-Za-z0-9._:-]{1,128}")
    }
}

/** Преобразует исключения за пределами MVC в стабильный error envelope. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 1)
internal class RecoveryFilter(private val objectMapper: ObjectMapper) : OncePerRequestFilter() {
    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, filterChain: FilterChain) {
        try {
            filterChain.doFilter(request, response)
        } catch (_: Exception) {
            if (!response.isCommitted) {
                response.resetBuffer()
                writeApiError(response, objectMapper, 500, "INTERNAL_ERROR", "Внутренняя ошибка", correlationId(request))
            }
        }
    }
}

/** Ограничивает браузерные запросы локальным origin и проверяет CSRF мутаций. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 2)
internal class LocalSecurityFilter(
    private val csrfTokenProvider: CsrfTokenProvider,
    private val objectMapper: ObjectMapper,
) : OncePerRequestFilter() {
    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, filterChain: FilterChain) {
        response.setHeader("X-Content-Type-Options", "nosniff")
        response.setHeader("X-Frame-Options", "DENY")
        response.setHeader("Referrer-Policy", "same-origin")
        val origin = request.getHeader("Origin")
        if (!origin.isNullOrBlank() && !isLocalOrigin(origin)) {
            writeApiError(response, objectMapper, 403, "ORIGIN_REJECTED", "Origin не разрешён", correlationId(request))
            return
        }
        if (request.method !in SAFE_METHODS && request.getHeader("X-CSRF-Token") != csrfTokenProvider.token()) {
            writeApiError(response, objectMapper, 403, "CSRF_REJECTED", "CSRF token недействителен", correlationId(request))
            return
        }
        filterChain.doFilter(request, response)
    }

    internal fun isLocalOrigin(value: String): Boolean {
        val uri = runCatching { URI(value) }.getOrNull() ?: return false
        if (uri.scheme != "http" || uri.userInfo != null || uri.host.isNullOrBlank()) return false
        val host = uri.host.removePrefix("[").removeSuffix("]")
        if (host.equals("localhost", true)) return true
        val literal = host.matches(Regex("[0-9.]+")) || host.matches(Regex("[0-9A-Fa-f:]+"))
        return literal && runCatching { InetAddress.getByName(host).isLoopbackAddress }.getOrDefault(false)
    }

    private companion object {
        val SAFE_METHODS = setOf("GET", "HEAD", "OPTIONS")
    }
}

internal fun correlationId(request: HttpServletRequest): String =
    request.getAttribute(CORRELATION_ATTRIBUTE)?.toString().orEmpty()

private fun writeApiError(
    response: HttpServletResponse,
    objectMapper: ObjectMapper,
    status: Int,
    code: String,
    message: String,
    correlationId: String,
) {
    response.status = status
    response.contentType = MediaType.APPLICATION_JSON_VALUE
    response.characterEncoding = Charsets.UTF_8.name()
    objectMapper.writeValue(
        response.outputStream,
        ApiErrorEnvelope(ApiError(code, message, correlationId = correlationId)),
    )
}
