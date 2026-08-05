package com.sorface.openspecstudio.config

import com.sorface.openspecstudio.application.CsrfTokenProvider
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import tools.jackson.databind.ObjectMapper

@DisplayName("Защитные фильтры локального API")
class ApiFiltersTest {
    private val mapper = ObjectMapper()
    private val tokens = CsrfTokenProvider { "valid-token" }

    @Test
    @DisplayName("сохраняет допустимый correlation ID и заменяет небезопасный")
    fun controlsCorrelationId() {
        val filter = CorrelationIdFilter()
        val accepted = MockHttpServletRequest().apply { addHeader(CORRELATION_HEADER, "request-123") }
        val acceptedResponse = MockHttpServletResponse()
        filter.doFilter(accepted, acceptedResponse) { _, _ -> }
        assertThat(acceptedResponse.getHeader(CORRELATION_HEADER)).isEqualTo("request-123")

        val unsafe = MockHttpServletRequest().apply { addHeader(CORRELATION_HEADER, "bad value") }
        val generated = MockHttpServletResponse()
        filter.doFilter(unsafe, generated) { _, _ -> }
        assertThat(generated.getHeader(CORRELATION_HEADER)).matches("[a-f0-9]{48}")
    }

    @Test
    @DisplayName("разрешает только локальный HTTP origin")
    fun validatesOrigin() {
        val filter = LocalSecurityFilter(tokens, mapper)
        assertThat(filter.isLocalOrigin("http://localhost:8787")).isTrue()
        assertThat(filter.isLocalOrigin("http://127.0.0.1:8787")).isTrue()
        assertThat(filter.isLocalOrigin("http://[::1]:8787")).isTrue()
        assertThat(filter.isLocalOrigin("https://localhost:8787")).isFalse()
        assertThat(filter.isLocalOrigin("http://example.com")).isFalse()
        assertThat(filter.isLocalOrigin("not a uri")).isFalse()
    }

    @Test
    @DisplayName("отклоняет внешний origin и mutation без CSRF")
    fun rejectsUnsafeRequests() {
        val filter = LocalSecurityFilter(tokens, mapper)
        val origin = MockHttpServletRequest("GET", "/api").apply { addHeader("Origin", "https://example.com") }
        CorrelationIdFilter().doFilter(origin, MockHttpServletResponse()) { request, _ ->
            val response = MockHttpServletResponse()
            filter.doFilter(request, response) { _, _ -> error("Не должен пройти") }
            assertThat(response.contentAsString).contains("ORIGIN_REJECTED")
        }

        val mutation = MockHttpServletRequest("POST", "/api")
        val response = MockHttpServletResponse()
        CorrelationIdFilter().doFilter(mutation, response) { request, correlatedResponse ->
            filter.doFilter(request, correlatedResponse) { _, _ -> error("Не должен пройти") }
        }
        assertThat(response.status).isEqualTo(403)
        assertThat(response.contentAsString).contains("CSRF_REJECTED", "correlationId")
    }

    @Test
    @DisplayName("пропускает safe methods и mutation с актуальным токеном")
    fun acceptsSafeRequests() {
        val filter = LocalSecurityFilter(tokens, mapper)
        for (method in listOf("GET", "HEAD", "OPTIONS", "POST")) {
            val request = MockHttpServletRequest(method, "/api").apply {
                if (method == "POST") addHeader("X-CSRF-Token", "valid-token")
            }
            var invoked = false
            val response = MockHttpServletResponse()
            filter.doFilter(request, response) { _, _ -> invoked = true }
            assertThat(invoked).isTrue()
            assertThat(response.getHeader("X-Content-Type-Options")).isEqualTo("nosniff")
        }
    }

    @Test
    @DisplayName("преобразует необработанное исключение в error envelope")
    fun recoversUnhandledException() {
        val request = MockHttpServletRequest("GET", "/api")
        val response = MockHttpServletResponse()
        CorrelationIdFilter().doFilter(request, response) { correlatedRequest, correlatedResponse ->
            RecoveryFilter(mapper).doFilter(correlatedRequest, correlatedResponse) { _, _ ->
                throw IllegalStateException("secret")
            }
        }
        assertThat(response.status).isEqualTo(500)
        assertThat(response.contentAsString).contains("INTERNAL_ERROR").doesNotContain("secret")
    }
}
