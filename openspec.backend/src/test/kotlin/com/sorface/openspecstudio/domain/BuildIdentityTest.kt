package com.sorface.openspecstudio.domain

import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatIllegalArgumentException
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

@DisplayName("Идентификатор сборки backend")
class BuildIdentityTest {
    @Test
    @DisplayName("сохраняет непустые имя и версию")
    fun storesValidIdentity() {
        val identity = BuildIdentity("OpenSpec Studio", "0.1.0")

        assertThat(identity.name).isEqualTo("OpenSpec Studio")
        assertThat(identity.version).isEqualTo("0.1.0")
    }

    @Test
    @DisplayName("отклоняет пустое имя")
    fun rejectsBlankName() {
        assertThatIllegalArgumentException()
            .isThrownBy { BuildIdentity(" ", "0.1.0") }
            .withMessage("Имя приложения не должно быть пустым")
    }

    @Test
    @DisplayName("отклоняет пустую версию")
    fun rejectsBlankVersion() {
        assertThatIllegalArgumentException()
            .isThrownBy { BuildIdentity("OpenSpec Studio", " ") }
            .withMessage("Версия приложения не должна быть пустой")
    }
}
