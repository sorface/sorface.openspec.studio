package com.sorface.openspecstudio

import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatIllegalArgumentException
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

@DisplayName("Параметры запуска локального backend")
class CommandLineOptionsTest {
    @Test
    @DisplayName("преобразует совместимые параметры в свойства Spring")
    fun normalizesLegacyOptions() {
        val result = CommandLineOptions.normalize(
            arrayOf("--address", "127.0.0.1:8787", "--data-dir", "./data", "--no-browser", "--debug"),
        )

        assertThat(result).containsExactly(
            "--server.address=127.0.0.1",
            "--server.port=8787",
            "--openspec.server.address=127.0.0.1:8787",
            "--openspec.server.data-dir=./data",
            "--openspec.server.no-browser=true",
            "--debug",
        )
    }

    @Test
    @DisplayName("отклоняет внешний bind address")
    fun rejectsExternalAddress() {
        assertThatIllegalArgumentException()
            .isThrownBy { CommandLineOptions.normalize(arrayOf("--address", "0.0.0.0:8080")) }
            .withMessageContaining("loopback")
    }

    @Test
    @DisplayName("отклоняет отсутствующее значение параметра")
    fun rejectsMissingValue() {
        assertThatIllegalArgumentException()
            .isThrownBy { CommandLineOptions.normalize(arrayOf("--data-dir")) }
            .withMessageContaining("требуется значение")
    }
}
