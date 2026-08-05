package com.sorface.openspecstudio

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.context.properties.ConfigurationPropertiesScan
import org.springframework.boot.runApplication
import org.springframework.context.ApplicationContextInitializer
import org.springframework.context.ConfigurableApplicationContext

@SpringBootApplication
@ConfigurationPropertiesScan
class OpenSpecStudioApplication

fun main(args: Array<String>) {
    runApplication<OpenSpecStudioApplication>(*CommandLineOptions.normalize(args)) {
        addInitializers(LoopbackServerInitializer())
    }
}

/** Проверяет фактический bind address до запуска web server. */
internal class LoopbackServerInitializer : ApplicationContextInitializer<ConfigurableApplicationContext> {
    override fun initialize(applicationContext: ConfigurableApplicationContext) {
        LoopbackAddress.requireHost(applicationContext.environment.getRequiredProperty("server.address"))
    }
}
