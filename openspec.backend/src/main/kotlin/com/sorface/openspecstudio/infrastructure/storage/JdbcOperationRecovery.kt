package com.sorface.openspecstudio.infrastructure.storage

import com.sorface.openspecstudio.application.OperationRecovery
import org.springframework.boot.ApplicationArguments
import org.springframework.boot.ApplicationRunner
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import java.time.Clock
import java.time.Instant

/** JDBC repository восстановления lifecycle операций. */
@Repository
internal class JdbcOperationRecovery(
    private val jdbcClient: JdbcClient,
    private val clock: Clock,
) : OperationRecovery, ApplicationRunner {
    override fun recoverInterrupted(): Int = jdbcClient.sql(
        """
        UPDATE operations
        SET status='failed', error_code='APPLICATION_RESTARTED',
            error_message='Приложение было перезапущено', updated_at=:updatedAt
        WHERE status IN ('queued','running','validating')
        """.trimIndent(),
    ).param("updatedAt", Instant.now(clock).toString()).update()

    override fun run(args: ApplicationArguments) {
        recoverInterrupted()
    }
}
