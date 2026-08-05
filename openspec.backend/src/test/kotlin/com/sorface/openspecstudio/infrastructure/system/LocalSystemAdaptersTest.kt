package com.sorface.openspecstudio.infrastructure.system

import com.sorface.openspecstudio.api.ToolCapability
import com.sorface.openspecstudio.application.ProcessAuditSink
import com.sorface.openspecstudio.infrastructure.process.SafeProcessRunner
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import tools.jackson.databind.ObjectMapper
import org.springframework.beans.factory.support.StaticListableBeanFactory

@DisplayName("Системные adapter-ы Kotlin backend")
class LocalSystemAdaptersTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    @DisplayName("создаёт стабильный криптографический CSRF-токен")
    fun createsStableToken() {
        val provider = SecureCsrfTokenProvider()
        assertThat(provider.token()).matches("[a-f0-9]{48}")
        assertThat(provider.token()).isEqualTo(provider.token())
        assertThat(SecureCsrfTokenProvider().token()).isNotEqualTo(provider.token())
    }

    @Test
    @DisplayName("обнаруживает версии, модели и поддержку AI CLI")
    fun detectsTools() {
        val probe = ExecutableProbe { name, arguments, _ ->
            when {
                name == "openspec" -> null
                name == "codex" && arguments == listOf("debug", "models") -> ProbeResult(
                    "/bin/codex",
                    """{"models":[{"slug":"gpt-5.4","visibility":"list"},{"slug":"hidden","visibility":"hide"},{"slug":"gpt-5.4","visibility":"list"}]}""",
                    true,
                )
                name == "gigacode" && arguments == listOf("--help") ->
                    ProbeResult("/bin/gigacode", "--non-interactive --json --cwd", true)
                else -> ProbeResult("/bin/$name", if (name == "git") "" else "$name 1", name != "git")
            }
        }
        val provider = LocalCapabilitiesProvider(probe, ObjectMapper(), "Mac OS X", "aarch64")

        val result = provider.detect()

        assertThat(result.os).isEqualTo("darwin")
        assertThat(result.arch).isEqualTo("arm64")
        assertThat(result.tools).containsExactly(
            ToolCapability("git", true, "/bin/git", "версия недоступна"),
            ToolCapability("openspec", false),
            ToolCapability("codex", true, "/bin/codex", "codex 1", true, true, listOf("gpt-5.4")),
            ToolCapability("gigacode", true, "/bin/gigacode", "gigacode 1", true, true),
        )
    }

    @Test
    @DisplayName("использует fallback catalog и выявляет неподдерживаемый GigaCode")
    fun usesModelFallback() {
        val probe = ExecutableProbe { name, arguments, _ -> when {
            name == "codex" && arguments == listOf("debug", "models") -> ProbeResult("/c", "bad", false)
            name == "codex" && arguments.lastOrNull() == "--bundled" ->
                ProbeResult("/c", """{"models":[{"slug":"bundled/model","visibility":""}]}""", true)
            name == "gigacode" && arguments == listOf("--help") -> ProbeResult("/g", "usage", true)
            else -> ProbeResult("/$name", "1", true)
        } }
        val result = LocalCapabilitiesProvider(probe, ObjectMapper(), "Windows", "x64").detect()
        assertThat(result.os).isEqualTo("windows")
        assertThat(result.arch).isEqualTo("amd64")
        assertThat(result.tools[2].models).containsExactly("bundled/model")
        assertThat(result.tools[3].supported).isFalse()
    }

    @Test
    @DisplayName("выполняет найденный executable и сообщает отсутствующий")
    fun probesPathExecutable() {
        val executable = tempDir.resolve("sample")
        Files.writeString(executable, "#!/bin/sh\necho sample-1\n")
        executable.toFile().setExecutable(true)
        val runner = SafeProcessRunner(StaticListableBeanFactory().getBeanProvider(ProcessAuditSink::class.java))
        val probe = PathExecutableProbe(runner, tempDir.toString())

        assertThat(probe.execute("sample", listOf("--version"), 2))
            .isEqualTo(ProbeResult(executable.toString(), "sample-1", true))
        assertThat(probe.execute("missing", emptyList(), 1)).isNull()
    }

    @Test
    @DisplayName("нормализует прочие платформы и архитектуры")
    fun normalizesPlatforms() {
        val provider = LocalCapabilitiesProvider({ _, _, _ -> null }, ObjectMapper(), "Free BSD", "riscv64")
        assertThat(provider.normalizeOs("Darwin")).isEqualTo("darwin")
        assertThat(provider.normalizeOs("Linux")).isEqualTo("linux")
        assertThat(provider.normalizeOs("Free BSD")).isEqualTo("free-bsd")
        assertThat(provider.normalizeArch("riscv64")).isEqualTo("riscv64")
    }
}
