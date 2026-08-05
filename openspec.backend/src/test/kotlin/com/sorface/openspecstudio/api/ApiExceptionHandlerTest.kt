package com.sorface.openspecstudio.api

import com.sorface.openspecstudio.domain.openspec.OpenSpecException
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.http.HttpStatus
import org.springframework.mock.web.MockHttpServletRequest

@DisplayName("HTTP mapping ошибок OpenSpec")
class ApiExceptionHandlerTest {
    private val handler = ApiExceptionHandler()

    @Test
    @DisplayName("возвращает 502 для ошибки выполнения OpenSpec CLI")
    fun mapsOpenSpecCommandFailureToBadGateway() {
        val response = handler.openspec(
            OpenSpecException("OPENSPEC_COMMAND_FAILED", "OpenSpec CLI вернул некорректный JSON"),
            MockHttpServletRequest(),
        )

        assertThat(response.statusCode).isEqualTo(HttpStatus.BAD_GATEWAY)
        assertThat(response.body?.error?.code).isEqualTo("OPENSPEC_COMMAND_FAILED")
    }

    @Test
    @DisplayName("сохраняет конфликтный статус для read-only violation")
    fun keepsReadOnlyViolationAsConflict() {
        val response = handler.openspec(
            OpenSpecException("OPENSPEC_READ_ONLY_VIOLATION", "Read-only команда изменила Store"),
            MockHttpServletRequest(),
        )

        assertThat(response.statusCode).isEqualTo(HttpStatus.CONFLICT)
        assertThat(response.body?.error?.code).isEqualTo("OPENSPEC_READ_ONLY_VIOLATION")
    }

    @Test
    @DisplayName("возвращает 502 для некорректного structured explore")
    fun mapsInvalidExplorationToBadGateway() {
        val response = handler.openspec(
            OpenSpecException("OPENSPEC_EXPLORE_INVALID", "Agent вернул некорректный результат исследования"),
            MockHttpServletRequest(),
        )

        assertThat(response.statusCode).isEqualTo(HttpStatus.BAD_GATEWAY)
        assertThat(response.body?.error?.code).isEqualTo("OPENSPEC_EXPLORE_INVALID")
    }
}
