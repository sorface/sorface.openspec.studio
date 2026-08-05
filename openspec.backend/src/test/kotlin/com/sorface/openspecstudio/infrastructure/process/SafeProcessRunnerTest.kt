package com.sorface.openspecstudio.infrastructure.process

import com.sorface.openspecstudio.application.ProcessAudit
import com.sorface.openspecstudio.application.ProcessAuditSink
import com.sorface.openspecstudio.application.ProcessCancellation
import com.sorface.openspecstudio.application.ProcessCommand
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.springframework.beans.factory.support.StaticListableBeanFactory
import java.nio.file.Path
import java.time.Duration
import java.util.concurrent.atomic.AtomicBoolean

@DisplayName("Безопасный process runner")
class SafeProcessRunnerTest {
    @TempDir lateinit var root: Path
    private val audits = RecordingAuditSink()
    private val runner = SafeProcessRunner(provider(audits))
    private val shell = Path.of("/bin/sh")

    @Test
    @DisplayName("запускает команду, стримит chunks и редактирует audit")
    fun runsAndAudits() {
        val chunks = mutableListOf<String>()
        val result = runner.run(ProcessCommand(
            shell, listOf("-c", "printf hello", "secret"), setOf(2), root,
            operationId = "operation-1", onStdout = { chunks += it.decodeToString() },
        ), ProcessCancellation.NONE)

        assertThat(result.stdout).isEqualTo("hello")
        assertThat(result.arguments).containsExactly("-c", "printf hello", "[REDACTED]")
        assertThat(chunks.joinToString("")).isEqualTo("hello")
        assertThat(audits.items.single().arguments).doesNotContain("secret").contains("[REDACTED]")
    }

    @Test
    @DisplayName("ограничивает stdout и допускает усечение stderr")
    fun limitsOutput() {
        val limited = runner.run(ProcessCommand(shell, listOf("-c", "printf 123456"), directory = root, maxOutputBytes = 3), ProcessCancellation.NONE)
        assertThat(limited.stopReason).isEqualTo("output_limit")
        assertThat(limited.stdout).isEqualTo("123")

        val allowed = runner.run(ProcessCommand(
            shell, listOf("-c", "printf ok; printf 123456 >&2"), directory = root,
            maxOutputBytes = 3, allowStderrTruncation = true,
        ), ProcessCancellation.NONE)
        assertThat(allowed.stdout).isEqualTo("ok")
        assertThat(allowed.stderr).isEqualTo("123")
        assertThat(allowed.stopReason).isEqualTo("stderr_truncated")
    }

    @Test
    @DisplayName("останавливает timeout и cancellation")
    fun stopsProcess() {
        val timeout = runner.run(ProcessCommand(shell, listOf("-c", "sleep 2"), directory = root, timeout = Duration.ofMillis(25)), ProcessCancellation.NONE)
        assertThat(timeout.stopReason).isEqualTo("timeout")
        val cancelled = AtomicBoolean(true)
        val result = runner.run(ProcessCommand(shell, listOf("-c", "sleep 2"), directory = root), ProcessCancellation(cancelled::get))
        assertThat(result.stopReason).isEqualTo("cancelled")
    }

    @Test
    @DisplayName("не наследует secrets и отклоняет relative executable")
    fun appliesPolicy() {
        val result = runner.run(ProcessCommand(
            shell, listOf("-c", "printf '%s|%s|%s' \"\$SSH_AUTH_SOCK\" \"\$GIT_TERMINAL_PROMPT\" \"\$UNSAFE_SECRET\""),
            directory = root, environment = mapOf("SSH_AUTH_SOCK" to "/tmp/agent", "GIT_TERMINAL_PROMPT" to "0", "UNSAFE_SECRET" to "hidden"),
        ), ProcessCancellation.NONE)
        assertThat(result.stdout).isEqualTo("/tmp/agent|0|")
        assertThatThrownBy { runner.run(ProcessCommand(Path.of("sh"), directory = root), ProcessCancellation.NONE) }
            .isInstanceOf(IllegalArgumentException::class.java)
    }

    @Test
    @DisplayName("supervisor заменяет и отменяет operation scope")
    fun supervises() {
        val supervisor = ProcessSupervisor()
        val first = supervisor.open("one")
        val second = supervisor.open("one")
        assertThat(first.cancellation.isCancelled()).isTrue()
        assertThat(supervisor.cancel("one")).isTrue()
        assertThat(second.cancellation.isCancelled()).isTrue()
        first.close(); second.close(); supervisor.close()
    }

    private fun provider(sink: ProcessAuditSink) = StaticListableBeanFactory(mapOf("audit" to sink))
        .getBeanProvider(ProcessAuditSink::class.java)

    private class RecordingAuditSink : ProcessAuditSink {
        val items = mutableListOf<ProcessAudit>()
        override fun save(audit: ProcessAudit) { items += audit }
    }
}
