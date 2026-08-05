package com.sorface.openspecstudio

import com.sorface.openspecstudio.runtime.RuntimeIdentity
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@DisplayName("Контекст Kotlin backend")
class ApplicationContextIT {
    @Autowired
    private lateinit var runtimeIdentity: RuntimeIdentity

    @Test
    @DisplayName("запускает Spring context и предоставляет application component")
    fun startsApplicationContext() {
        assertThat(runtimeIdentity.describe().language).isEqualTo("Kotlin")
    }
}
