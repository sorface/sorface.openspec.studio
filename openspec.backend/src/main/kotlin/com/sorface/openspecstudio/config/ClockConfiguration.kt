package com.sorface.openspecstudio.config

import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import java.time.Clock

/** Общие детерминируемые зависимости времени. */
@Configuration
internal class ClockConfiguration {
    @Bean
    fun clock(): Clock = Clock.systemUTC()
}
