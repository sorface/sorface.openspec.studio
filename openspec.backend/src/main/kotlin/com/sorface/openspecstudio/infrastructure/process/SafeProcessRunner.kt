package com.sorface.openspecstudio.infrastructure.process

import com.sorface.openspecstudio.application.ProcessAudit
import com.sorface.openspecstudio.application.ProcessAuditSink
import com.sorface.openspecstudio.application.ProcessCancellation
import com.sorface.openspecstudio.application.ProcessCommand
import com.sorface.openspecstudio.application.ProcessResult
import com.sorface.openspecstudio.application.ProcessRunner
import org.springframework.beans.factory.ObjectProvider
import org.springframework.stereotype.Component
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.LinkOption
import java.time.Duration
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/** ProcessBuilder adapter с ограниченным окружением и остановкой полного process tree. */
@Component
internal class SafeProcessRunner(audits: ObjectProvider<ProcessAuditSink>) : ProcessRunner {
    private val auditSink = audits.ifAvailable

    override fun run(command: ProcessCommand, cancellation: ProcessCancellation): ProcessResult {
        validate(command)
        val builder = ProcessBuilder(listOf(command.executable.toString()) + command.arguments)
            .directory(command.directory.toFile())
        builder.environment().apply { clear(); putAll(safeEnvironment(command.environment)) }
        val startedAt = System.nanoTime()
        val process = builder.start()
        process.outputStream.bufferedWriter(StandardCharsets.UTF_8).use { if (command.stdin.isNotEmpty()) it.write(command.stdin) }
        val stdout = StreamCapture(process.inputStream, command.maxOutputBytes, command.onStdout)
        val stderr = StreamCapture(process.errorStream, command.maxOutputBytes, command.onStderr)
        val stdoutThread = Thread.ofVirtual().start(stdout::read)
        val stderrThread = Thread.ofVirtual().start(stderr::read)
        var stopReason = ""
        val deadline = if (command.disableTimeout) Long.MAX_VALUE else startedAt + command.timeout.toNanos()
        while (process.isAlive) {
            stopReason = when {
                cancellation.isCancelled() -> "cancelled"
                System.nanoTime() >= deadline -> "timeout"
                stdout.exceeded.get() -> "output_limit"
                stderr.exceeded.get() && !command.allowStderrTruncation -> "output_limit"
                else -> ""
            }
            if (stopReason.isNotEmpty()) terminateTree(process) else process.waitFor(10, TimeUnit.MILLISECONDS)
        }
        stdoutThread.join(2_000)
        stderrThread.join(2_000)
        if (stopReason.isEmpty() && stdout.exceeded.get()) stopReason = "output_limit"
        if (stopReason.isEmpty() && stderr.exceeded.get() && !command.allowStderrTruncation) stopReason = "output_limit"
        if (stopReason.isEmpty() && stderr.exceeded.get()) stopReason = "stderr_truncated"
        val result = ProcessResult(
            stdout.text(), stderr.text(), process.exitValue(), Duration.ofNanos(System.nanoTime() - startedAt),
            stopReason, redact(command.arguments, command.redactArgumentIndexes), stdout.total.get(), stderr.total.get(),
        )
        command.operationId?.let { id ->
            auditSink?.save(ProcessAudit(
                id, command.executable.fileName.toString(), result.arguments.joinToString(" "), result.exitCode,
                result.stopReason, result.stdoutBytes, result.stderrBytes, result.duration.toMillis(),
            ))
        }
        return result
    }

    private fun validate(command: ProcessCommand) {
        require(command.executable.isAbsolute && Files.isRegularFile(command.executable) &&
            Files.isExecutable(command.executable)) { "Executable must be an absolute executable file" }
        require(command.directory.isAbsolute && Files.isDirectory(command.directory, LinkOption.NOFOLLOW_LINKS)) {
            "Working directory must be an absolute directory"
        }
        require(command.maxOutputBytes > 0) { "Output limit must be positive" }
        require(command.disableTimeout || !command.timeout.isNegative && !command.timeout.isZero) { "Timeout must be positive" }
    }

    private fun safeEnvironment(explicit: Map<String, String>): Map<String, String> {
        val result = linkedMapOf<String, String>()
        INHERITED_KEYS.forEach { key -> System.getenv(key)?.takeIf(String::isNotBlank)?.let { result[key] = it } }
        explicit.filterKeys(::isAllowedEnvironmentKey).forEach { (key, value) -> result[key] = value }
        return result
    }

    private fun isAllowedEnvironmentKey(key: String): Boolean = key in EXPLICIT_KEYS ||
        key.startsWith("CODEX_") || key.startsWith("GIT_")

    private fun redact(arguments: List<String>, indexes: Set<Int>) =
        arguments.mapIndexed { index, value -> if (index in indexes) "[REDACTED]" else value }

    private fun terminateTree(process: Process) {
        val descendants = process.descendants().toList().asReversed()
        descendants.forEach(ProcessHandle::destroy)
        process.destroy()
        if (!process.waitFor(250, TimeUnit.MILLISECONDS)) {
            descendants.forEach(ProcessHandle::destroyForcibly)
            process.destroyForcibly().waitFor()
        }
    }

    private class StreamCapture(
        private val input: InputStream,
        private val limit: Long,
        private val callback: (ByteArray) -> Unit,
    ) {
        private val output = ByteArrayOutputStream()
        val total = AtomicLong()
        val exceeded = AtomicBoolean()

        fun read() = input.use {
            val buffer = ByteArray(8192)
            while (true) {
                val count = runCatching { it.read(buffer) }.getOrDefault(-1)
                if (count < 0) break
                val previous = total.getAndAdd(count.toLong())
                val accepted = (limit - previous).coerceIn(0, count.toLong()).toInt()
                if (accepted > 0) {
                    val chunk = buffer.copyOf(accepted)
                    synchronized(output) { output.write(chunk) }
                    callback(chunk)
                }
                if (accepted < count) exceeded.set(true)
            }
        }

        fun text(): String = synchronized(output) { output.toString(StandardCharsets.UTF_8) }
    }

    private companion object {
        val INHERITED_KEYS = setOf("PATH", "HOME")
        val EXPLICIT_KEYS = setOf("PATH", "HOME", "LANG", "LC_ALL", "SSH_AUTH_SOCK")
    }
}
