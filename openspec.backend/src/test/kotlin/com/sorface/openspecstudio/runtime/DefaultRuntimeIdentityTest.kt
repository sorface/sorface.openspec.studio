package com.sorface.openspecstudio.runtime

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

@DisplayName("Идентификация Kotlin runtime")
class DefaultRuntimeIdentityTest {
    private val identity: RuntimeIdentity = DefaultRuntimeIdentity()

    @Test
    @DisplayName("возвращает стабильное имя сервиса и язык backend")
    fun describesRuntime() {
        assertThat(identity.describe()).isEqualTo(
            RuntimeDescriptor(service = "OpenSpec Studio", language = "Kotlin"),
        )
    }
}
