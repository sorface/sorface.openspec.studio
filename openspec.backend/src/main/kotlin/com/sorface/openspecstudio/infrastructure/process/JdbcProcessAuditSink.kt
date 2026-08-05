package com.sorface.openspecstudio.infrastructure.process

import com.sorface.openspecstudio.application.ProcessAudit
import com.sorface.openspecstudio.application.ProcessAuditSink
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import java.time.Clock
import java.time.Instant

/** SQLite adapter безопасного process audit. */
@Repository
internal class JdbcProcessAuditSink(private val jdbc: JdbcClient, private val clock: Clock) : ProcessAuditSink {
    override fun save(audit: ProcessAudit) {
        jdbc.sql(
            """
            INSERT INTO operation_audit
                (operation_id, executable, arguments, exit_code, stop_reason, stdout_bytes, stderr_bytes, duration_ms, created_at)
            VALUES (:operationId, :executable, :arguments, :exitCode, :stopReason, :stdoutBytes, :stderrBytes, :durationMs, :createdAt)
            ON CONFLICT(operation_id) DO UPDATE SET
                executable=excluded.executable, arguments=excluded.arguments, exit_code=excluded.exit_code,
                stop_reason=excluded.stop_reason, stdout_bytes=excluded.stdout_bytes,
                stderr_bytes=excluded.stderr_bytes, duration_ms=excluded.duration_ms, created_at=excluded.created_at
            """.trimIndent(),
        ).params(
            mapOf(
                "operationId" to audit.operationId,
                "executable" to audit.executable,
                "arguments" to audit.arguments,
                "exitCode" to audit.exitCode,
                "stopReason" to audit.stopReason,
                "stdoutBytes" to audit.stdoutBytes,
                "stderrBytes" to audit.stderrBytes,
                "durationMs" to audit.durationMs,
                "createdAt" to Instant.now(clock).toString(),
            ),
        ).update()
    }
}
