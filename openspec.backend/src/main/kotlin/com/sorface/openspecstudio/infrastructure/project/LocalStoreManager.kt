package com.sorface.openspecstudio.infrastructure.project

import com.sorface.openspecstudio.application.StoreManager
import com.sorface.openspecstudio.config.LocalServerProperties
import com.sorface.openspecstudio.domain.project.ProjectException
import org.springframework.stereotype.Component
import java.io.ByteArrayOutputStream
import java.net.URI
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.util.concurrent.TimeUnit

/** Проверяет и клонирует Store только через найденный Git executable. */
@Component
internal class LocalStoreManager(
    properties: LocalServerProperties,
    private val gitPath: Path? = findExecutable("git"),
) : StoreManager {
    private val managedRoot = properties.dataDir.resolve("projects").toAbsolutePath().normalize()

    override fun validate(path: String): String {
        val requested = runCatching { Path.of(path) }.getOrElse { invalidPath() }
        if (!requested.isAbsolute || isGitRemote(path) || Files.isSymbolicLink(requested)) invalidPath()
        val canonical = runCatching { requested.toRealPath(LinkOption.NOFOLLOW_LINKS) }.getOrElse { invalidPath() }
        if (!Files.isDirectory(canonical, LinkOption.NOFOLLOW_LINKS)) invalidPath()
        val git = gitPath ?: throw ProjectException("GIT_UNAVAILABLE", "Git недоступен")
        val result = run(git, canonical, 15, listOf("rev-parse", "--show-toplevel"))
        if (!result.successful) throw ProjectException("INVALID_STORE", "Каталог не является отдельным Git worktree")
        val root = runCatching { Path.of(result.output.trim()).toRealPath() }.getOrElse {
            throw ProjectException("INVALID_STORE", "Каталог не является отдельным Git worktree")
        }
        if (root != canonical) throw ProjectException("INVALID_STORE", "Каталог не является отдельным Git worktree")
        return canonical.toString()
    }

    override fun clone(remote: String): String {
        val normalized = normalizeGitRemote(remote)
        val git = gitPath ?: throw ProjectException("GIT_UNAVAILABLE", "Git недоступен")
        Files.createDirectories(managedRoot)
        val projectRoot = Files.createTempDirectory(managedRoot.toRealPath(), "${remoteName(normalized)}-")
        val target = projectRoot.resolve("store")
        val result = run(git, projectRoot, 30 * 60, listOf("clone", "--progress", "--", normalized, target.toString()))
        if (!result.successful) {
            projectRoot.toFile().deleteRecursively()
            val lower = result.output.lowercase()
            val code = when {
                "host key verification failed" in lower -> "SSH_HOST_KEY_FAILED"
                "permission denied" in lower || "authentication failed" in lower || "publickey" in lower -> "GIT_AUTH_FAILED"
                else -> "GIT_CLONE_FAILED"
            }
            throw ProjectException(code, "Git завершился с ошибкой")
        }
        return validate(target.toString())
    }

    private fun normalizeGitRemote(value: String): String {
        val remote = value.trim()
        if (remote.isEmpty() || remote.startsWith('-') || remote.any { it == '\u0000' || it == '\r' || it == '\n' }) {
            throw ProjectException("INVALID_GIT_URL", "Некорректный Git URL")
        }
        if (SCP_REMOTE.matches(remote)) return remote
        val uri = runCatching { URI(remote) }.getOrElse { invalidGitUrl() }
        if (uri.scheme !in setOf("https", "ssh") || uri.host.isNullOrBlank() || uri.userInfo?.contains(':') == true) invalidGitUrl()
        return remote
    }

    private fun isGitRemote(value: String): Boolean = SCP_REMOTE.matches(value) ||
        runCatching { URI(value).scheme in setOf("https", "ssh") }.getOrDefault(false)

    private fun remoteName(remote: String): String = remote.trimEnd('/').removeSuffix(".git")
        .substringAfterLast('/').substringAfterLast(':').lowercase()
        .replace(Regex("[^a-z0-9._-]+"), "-").trim('.', '-', '_').ifEmpty { "repository" }

    private fun invalidPath(): Nothing = throw ProjectException(
        "INVALID_STORE_PATH",
        "Укажите абсолютный путь к локальному Store или используйте режим клонирования",
    )

    private fun invalidGitUrl(): Nothing = throw ProjectException("INVALID_GIT_URL", "Некорректный Git URL")

    private data class CommandResult(val output: String, val successful: Boolean)

    private fun run(executable: Path, directory: Path, timeoutSeconds: Long, arguments: List<String>): CommandResult {
        val process = ProcessBuilder(listOf(executable.toString(), "-C", directory.toString()) + arguments)
            .redirectErrorStream(true)
            .apply { environment()["GIT_TERMINAL_PROMPT"] = "0" }
            .start()
        val captured = ByteArrayOutputStream()
        val reader = Thread.ofVirtual().start { runCatching { process.inputStream.use { it.transferTo(captured) } } }
        val finished = process.waitFor(timeoutSeconds, TimeUnit.SECONDS)
        if (!finished) process.destroyForcibly().waitFor()
        reader.join(TimeUnit.SECONDS.toMillis(1))
        return CommandResult(captured.toString(StandardCharsets.UTF_8), finished && process.exitValue() == 0)
    }

    private companion object {
        val SCP_REMOTE = Regex("^[^/@:\\s]+@[^/:\\s]+:[^:\\s].+$")

        fun findExecutable(name: String): Path? = System.getenv("PATH").orEmpty()
            .split(System.getProperty("path.separator"))
            .asSequence().filter(String::isNotBlank).map { Path.of(it, name) }
            .firstOrNull { Files.isRegularFile(it) && Files.isExecutable(it) }
    }
}
