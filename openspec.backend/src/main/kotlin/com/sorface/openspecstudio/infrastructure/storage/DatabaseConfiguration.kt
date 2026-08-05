package com.sorface.openspecstudio.infrastructure.storage

import com.sorface.openspecstudio.config.LocalServerProperties
import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import java.nio.file.Files
import javax.sql.DataSource

/** Настраивает единственное совместимое соединение с локальной SQLite. */
@Configuration
internal class DatabaseConfiguration {
    @Bean(destroyMethod = "close")
    fun dataSource(properties: LocalServerProperties): DataSource {
        Files.createDirectories(properties.dataDir)
        val database = properties.dataDir.resolve("openspec-studio.db").toAbsolutePath().normalize()
        return HikariDataSource(HikariConfig().apply {
            jdbcUrl = "jdbc:sqlite:$database?foreign_keys=on&busy_timeout=5000&journal_mode=WAL"
            driverClassName = "org.sqlite.JDBC"
            maximumPoolSize = 1
            minimumIdle = 1
            poolName = "openspec-sqlite"
        })
    }
}
