package com.sorface.openspecstudio.config

import com.sorface.openspecstudio.LoopbackAddress
import org.springframework.boot.context.properties.ConfigurationProperties
import java.nio.file.Path

/** Настройки локального backend, совместимые с параметрами Go-приложения. */
@ConfigurationProperties("openspec.server")
data class LocalServerProperties(
    val address: String = "127.0.0.1:0",
    val dataDir: Path = Path.of(System.getProperty("user.home"), ".osstudio"),
    val noBrowser: Boolean = false,
) {
    init {
        LoopbackAddress.parse(address)
    }
}
