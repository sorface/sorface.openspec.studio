package com.sorface.openspecstudio.application

import java.nio.file.Path
import java.time.Duration

data class ProcessCommand(
    val executable: Path,
    val arguments: List<String> = emptyList(),
    val redactArgumentIndexes: Set<Int> = emptySet(),
    val directory: Path,
    val stdin: String = "",
    val environment: Map<String, String> = emptyMap(),
    val timeout: Duration = Duration.ofMinutes(10),
    val disableTimeout: Boolean = false,
    val maxOutputBytes: Long = 1L shl 20,
    val allowStderrTruncation: Boolean = false,
    val operationId: String? = null,
    val onStdout: (ByteArray) -> Unit = {},
    val onStderr: (ByteArray) -> Unit = {},
)

data class ProcessResult(
    val stdout: String,
    val stderr: String,
    val exitCode: Int,
    val duration: Duration,
    val stopReason: String = "",
    val arguments: List<String> = emptyList(),
    val stdoutBytes: Long = 0,
    val stderrBytes: Long = 0,
) { val successful: Boolean get() = exitCode == 0 && stopReason in setOf("", "stderr_truncated") }

/** Токен кооперативной отмены external process. */
fun interface ProcessCancellation {
    /** Сообщает, следует ли остановить process tree. */
    fun isCancelled(): Boolean
    companion object { val NONE = ProcessCancellation { false } }
}

/** Без shell запускает абсолютный executable в контролируемом environment. */
fun interface ProcessRunner {
    /** Выполняет команду с timeout, cancellation и output limits. */
    fun run(command: ProcessCommand, cancellation: ProcessCancellation): ProcessResult
}

data class ProcessAudit(
    val operationId: String,
    val executable: String,
    val arguments: String,
    val exitCode: Int,
    val stopReason: String,
    val stdoutBytes: Long,
    val stderrBytes: Long,
    val durationMs: Long,
)

/** Сохраняет process metadata без stdin, credentials и файлового содержимого. */
fun interface ProcessAuditSink {
    /** Записывает безопасный audit завершённого запуска. */
    fun save(audit: ProcessAudit)
}
