package com.sorface.openspecstudio.infrastructure.system

import com.sorface.openspecstudio.api.SystemCapabilities
import com.sorface.openspecstudio.api.ToolCapability
import com.sorface.openspecstudio.application.CapabilitiesProvider
import com.sorface.openspecstudio.application.CsrfTokenProvider
import com.sorface.openspecstudio.application.ProcessCancellation
import com.sorface.openspecstudio.application.ProcessCommand
import com.sorface.openspecstudio.application.ProcessRunner
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import java.nio.file.Files
import java.nio.file.Path
import java.security.SecureRandom
import java.time.Duration
import tools.jackson.databind.ObjectMapper

/** Результат диагностического запуска CLI. */
data class ProbeResult(val path: String, val output: String, val successful: Boolean)

/** Граница запуска коротких диагностических команд. */
fun interface ExecutableProbe {
    /** Без shell запускает найденный executable с ограничением времени. */
    fun execute(name: String, arguments: List<String>, timeoutSeconds: Long): ProbeResult?
}

internal class PathExecutableProbe(
    private val runner: ProcessRunner,
    private val pathValue: String = System.getenv("PATH").orEmpty(),
) : ExecutableProbe {
    override fun execute(name: String, arguments: List<String>, timeoutSeconds: Long): ProbeResult? {
        val executable = pathValue.split(System.getProperty("path.separator"))
            .asSequence()
            .filter(String::isNotBlank)
            .map { Path.of(it, name) }
            .firstOrNull { Files.isRegularFile(it) && Files.isExecutable(it) }
            ?: return null
        val result = runner.run(
            ProcessCommand(
                executable = executable,
                arguments = arguments,
                directory = Path.of(System.getProperty("java.io.tmpdir")).toRealPath(),
                timeout = Duration.ofSeconds(timeoutSeconds),
                maxOutputBytes = 256L shl 10,
                allowStderrTruncation = true,
            ),
            ProcessCancellation.NONE,
        )
        return ProbeResult(executable.toString(), (result.stdout + result.stderr).trim(), result.successful)
    }
}

internal class SecureCsrfTokenProvider : CsrfTokenProvider {
    private val value = ByteArray(24).also(SecureRandom()::nextBytes)
        .joinToString(separator = "") { "%02x".format(it) }

    override fun token(): String = value
}

internal class LocalCapabilitiesProvider(
    private val probe: ExecutableProbe,
    private val objectMapper: ObjectMapper,
    private val osName: String = System.getProperty("os.name"),
    private val architecture: String = System.getProperty("os.arch"),
) : CapabilitiesProvider {
    override fun detect(): SystemCapabilities = SystemCapabilities(
        os = normalizeOs(osName),
        arch = normalizeArch(architecture),
        tools = TOOL_NAMES.map(::detectOne),
    )

    private fun detectOne(name: String): ToolCapability {
        val version = probe.execute(name, listOf("--version"), 2) ?: return ToolCapability(name, false)
        val versionText = version.output.ifBlank { if (version.successful) "" else "версия недоступна" }
        return when (name) {
            "codex" -> ToolCapability(
                name = name,
                available = true,
                path = version.path,
                version = versionText,
                supported = true,
                nonInteractive = true,
                models = detectCodexModels(),
            )
            "gigacode" -> {
                val help = probe.execute(name, listOf("--help"), 2)?.output.orEmpty()
                val supported = REQUIRED_GIGACODE_ARGUMENTS.all(help::contains)
                ToolCapability(name, true, version.path, versionText, supported, supported)
            }
            else -> ToolCapability(name, true, version.path, versionText)
        }
    }

    private fun detectCodexModels(): List<String> {
        for (arguments in listOf(listOf("debug", "models"), listOf("debug", "models", "--bundled"))) {
            val result = probe.execute("codex", arguments, 4) ?: continue
            if (!result.successful) continue
            val root = runCatching { objectMapper.readTree(result.output) }.getOrNull() ?: continue
            val models = root.path("models").mapNotNull { model ->
                val slug = model.path("slug").asText()
                val visibility = model.path("visibility").asText()
                slug.takeIf { MODEL_SLUG.matches(it) && (visibility.isBlank() || visibility == "list") }
            }.distinct()
            if (models.isNotEmpty()) return models
        }
        return emptyList()
    }

    internal fun normalizeOs(value: String): String = when {
        value.contains("mac", true) || value.contains("darwin", true) -> "darwin"
        value.contains("win", true) -> "windows"
        value.contains("linux", true) -> "linux"
        else -> value.lowercase().replace(" ", "-")
    }

    internal fun normalizeArch(value: String): String = when (value.lowercase()) {
        "aarch64", "arm64" -> "arm64"
        "x86_64", "amd64", "x64" -> "amd64"
        else -> value.lowercase()
    }

    private companion object {
        val TOOL_NAMES = listOf("git", "openspec", "codex", "gigacode")
        val REQUIRED_GIGACODE_ARGUMENTS = listOf("--non-interactive", "--json", "--cwd")
        val MODEL_SLUG = Regex("[A-Za-z0-9._:/-]{1,100}")
    }
}

/** Production wiring системных adapter-ов. */
@Configuration
internal class SystemAdapterConfiguration {
    @Bean
    fun csrfTokenProvider(): CsrfTokenProvider = SecureCsrfTokenProvider()

    @Bean
    fun executableProbe(runner: ProcessRunner): ExecutableProbe = PathExecutableProbe(runner)

    @Bean
    fun capabilitiesProvider(probe: ExecutableProbe, objectMapper: ObjectMapper): CapabilitiesProvider =
        LocalCapabilitiesProvider(probe, objectMapper)
}
