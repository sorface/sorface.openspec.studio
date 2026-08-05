package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.config.LocalServerProperties
import com.sorface.openspecstudio.domain.git.GitPushCommand
import com.sorface.openspecstudio.domain.project.Project
import com.sorface.openspecstudio.domain.project.ProjectException
import com.sorface.openspecstudio.domain.taskcontext.ConfirmPublicationCommand
import com.sorface.openspecstudio.domain.taskcontext.GeneratePublicationMessageCommand
import com.sorface.openspecstudio.domain.taskcontext.PublicationMessageRequest
import com.sorface.openspecstudio.domain.taskcontext.PublicationPreview
import com.sorface.openspecstudio.domain.taskcontext.PublicationResult
import com.sorface.openspecstudio.domain.taskcontext.TaskContextException
import org.springframework.beans.factory.ObjectProvider
import org.springframework.stereotype.Service
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap

/** Формирует scoped preview и атомарно публикует только OpenSpec-артефакты активной задачи. */
@Service
internal class PublicationService(
    private val projects: ProjectRepository,
    private val runner: ProcessRunner,
    private val gitService: GitService,
    generators: ObjectProvider<PublicationMessageGenerator>,
    private val clock: Clock,
    properties: LocalServerProperties,
) {
    private val generator = generators.ifAvailable
    private val git = findExecutable("git")
    private val previewRoot = properties.dataDir.resolve("publication-previews")
    private val previews = ConcurrentHashMap<String, StoredPreview>()

    fun preview(projectId: String): PublicationPreview {
        val project = project(projectId)
        val candidate = candidate(project)
        val agentDiff = candidate.diff.take(MAX_AGENT_DIFF)
        val now = Instant.now(clock)
        val result = PublicationPreview(
            token = token(), task = candidate.task, paths = candidate.paths, excludedCount = candidate.excluded,
            message = "${candidate.task}: публикация OpenSpec-артефактов",
            diffTruncated = candidate.diff.length > MAX_AGENT_DIFF, expiresAt = now.plus(PREVIEW_TTL),
        )
        previews.entries.removeIf { it.value.preview.expiresAt.isBefore(now) }
        previews[result.token] = StoredPreview(result, projectId, candidate.workspaceId, candidate.path, candidate.head,
            candidate.fingerprint, agentDiff, project.defaultAiProvider.orEmpty().trim(), project.defaultModel.orEmpty().trim())
        return result
    }

    fun generate(projectId: String, command: GeneratePublicationMessageCommand): PublicationPreview {
        val stored = current(projectId, command.token)
        val adapter = generator ?: fail("PUBLICATION_MESSAGE_UNAVAILABLE", "Генератор сообщения недоступен")
        if (stored.provider.isBlank()) fail("PUBLICATION_MESSAGE_UNAVAILABLE", "AI provider не настроен")
        val generated = runCatching { adapter.generate(PublicationMessageRequest(stored.preview.task, stored.preview.paths,
            stored.agentDiff, stored.provider, stored.model)) }.getOrElse {
            fail("PUBLICATION_MESSAGE_UNAVAILABLE", "Не удалось сформировать сообщение")
        }
        if (!validMessage(generated.subject, generated.body, stored.preview.task) ||
            generated.body.lineSequence().filter(String::isNotBlank).any { !it.trim().startsWith("- ") })
            fail("PUBLICATION_MESSAGE_UNAVAILABLE", "Некорректное сообщение генератора")
        val updated = stored.copy(preview = stored.preview.copy(message = generated.subject.trim(), body = generated.body.trim(), generatedBy = "agent"))
        if (!previews.replace(stored.preview.token, stored, updated)) fail("PUBLICATION_STALE", "Preview устарел")
        return updated.preview
    }

    fun confirm(projectId: String, command: ConfirmPublicationCommand, correlationId: String): PublicationResult {
        val stored = current(projectId, command.token)
        val project = project(projectId)
        val canonical = runCatching { Path.of(project.storePath).toRealPath() }.getOrNull()
        if (project.activeWorktreeId != stored.workspaceId || project.activeTask != stored.preview.task || canonical != stored.path)
            fail("PUBLICATION_STALE", "Активная задача изменилась")
        val fresh = candidate(project)
        if (fresh.head != stored.head || fresh.fingerprint != stored.fingerprint || fresh.paths != stored.preview.paths)
            fail("PUBLICATION_STALE", "Артефакты изменились")
        val message = command.message.trim().ifBlank { stored.preview.message }
        val body = if (command.message.isBlank()) stored.preview.body else command.body.trim()
        if (!validMessage(message, body, stored.preview.task)) fail("PUBLICATION_FAILED", "Некорректное сообщение")
        if (output(stored.path, "remote").isBlank()) fail("PUBLICATION_REMOTE_UNAVAILABLE", "Remote недоступен")
        requireSuccess(run(stored.path, listOf("add", "-A", "--") + stored.preview.paths, Duration.ofSeconds(30)))
        val args = buildList {
            addAll(listOf("commit", "-m", message)); if (body.isNotBlank()) addAll(listOf("-m", body))
            add("--"); addAll(stored.preview.paths)
        }
        requireSuccess(run(stored.path, args, Duration.ofMinutes(2)))
        val commit = output(stored.path, "rev-parse", "HEAD")
        if (commit == stored.head) fail("PUBLICATION_FAILED", "Commit не создан")
        val operation = try {
            gitService.startPush(projectId, GitPushCommand("origin", stored.preview.task), correlationId)
        } catch (exception: Exception) {
            when ((exception as? com.sorface.openspecstudio.domain.git.GitException)?.code) {
                "GIT_REMOTE_NOT_FOUND" -> fail("PUBLICATION_REMOTE_UNAVAILABLE", "Remote недоступен")
                "GIT_NON_FAST_FORWARD" -> fail("PUBLICATION_REMOTE_CHANGED", "Remote ветка изменилась")
                "GIT_AUTH_FAILED" -> fail("PUBLICATION_AUTH_FAILED", "Git authentication failed")
                "GIT_OPERATION_CONFLICT" -> fail("PUBLICATION_IN_PROGRESS", "Публикация уже выполняется")
                else -> throw exception
            }
        }
        previews.remove(stored.preview.token)
        return PublicationResult(stored.preview.task, commit, operation)
    }

    private fun current(projectId: String, token: String): StoredPreview {
        val stored = previews[token.trim()] ?: fail("PUBLICATION_STALE", "Preview не найден")
        if (stored.projectId != projectId || !stored.preview.expiresAt.isAfter(Instant.now(clock))) {
            previews.remove(token.trim())
            fail("PUBLICATION_STALE", "Preview устарел")
        }
        return stored
    }

    private fun candidate(project: Project): Candidate {
        val workspaceId = project.activeWorktreeId ?: fail("TASK_WORKSPACE_UNAVAILABLE", "Активная задача не выбрана")
        val task = project.activeTask?.trim().orEmpty().ifBlank { fail("TASK_WORKSPACE_UNAVAILABLE", "Активная задача не выбрана") }
        val path = runCatching { Path.of(project.storePath).toRealPath() }.getOrElse { fail("TASK_WORKSPACE_UNAVAILABLE", "Worktree недоступен") }
        if (output(path, "branch", "--show-current") != task) fail("TASK_WORKSPACE_UNAVAILABLE", "Ветка worktree изменилась")
        val head = output(path, "rev-parse", "HEAD")
        Files.createDirectories(previewRoot)
        val temporary = Files.createTempDirectory(previewRoot, "publication-")
        try {
            val index = temporary.resolve("index")
            val environment = mapOf("GIT_INDEX_FILE" to index.toString(), "GIT_TERMINAL_PROMPT" to "0")
            requireSuccess(run(path, listOf("read-tree", "HEAD"), environment = environment))
            requireSuccess(run(path, listOf("add", "-A", "--", "openspec"), environment = environment))
            val paths = output(path, listOf("diff", "--cached", "--no-renames", "--name-only", "-z", "--", "openspec"), environment)
                .split('\u0000').map(String::trim).filter(String::isNotBlank).map { it.replace('\\', '/') }.sorted()
            if (paths.isEmpty()) fail("PUBLICATION_EMPTY", "Нет изменений для публикации")
            if (paths.any { !validPath(path, it) }) fail("PUBLICATION_SCOPE_INVALID", "Недопустимый OpenSpec-файл")
            val diff = output(path, listOf("diff", "--cached", "--no-renames", "--no-ext-diff", "--unified=3", "--", "openspec"), environment, MAX_DIFF)
            val status = output(path, listOf("status", "--porcelain=v1", "--untracked-files=all"), maxBytes = 256L shl 10)
            val excluded = status.lineSequence().count { line -> line.length >= 4 && !line.substring(3).trim().replace('\\', '/').startsWith("openspec/") }
            return Candidate(task, head, path, workspaceId, paths, diff, excluded, fingerprint(task, head, paths, diff))
        } finally {
            temporary.toFile().deleteRecursively()
        }
    }

    private fun validPath(root: Path, value: String): Boolean {
        if (!value.startsWith("openspec/") || value.contains("../") || Path.of(value).isAbsolute) return false
        val lower = value.lowercase()
        if (lower.endsWith(".pem") || lower.endsWith(".key") || "/.env" in lower) return false
        val target = root.resolve(value).normalize()
        return target.startsWith(root) && (!Files.exists(target) || Files.isRegularFile(target) && !Files.isSymbolicLink(target))
    }
    private fun validMessage(subject: String, body: String, task: String): Boolean {
        val clean = subject.trim(); val prefix = "$task: "
        return clean.startsWith(prefix) && clean.removePrefix(prefix).isNotBlank() && '\n' !in clean && '\r' !in clean && clean.length <= 240 && body.length <= 16 * 1024
    }
    private fun fingerprint(task: String, head: String, paths: List<String>, diff: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update("$task\u0000$head\u0000".toByteArray())
        paths.forEach { digest.update("$it\u0000".toByteArray()) }
        digest.update(diff.toByteArray())
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
    private fun output(path: Path, vararg args: String) = output(path, args.toList())
    private fun output(path: Path, args: List<String>, environment: Map<String, String> = emptyMap(), maxBytes: Long = 2L shl 20): String =
        run(path, args, environment = environment, maxBytes = maxBytes).also(::requireSuccess).stdout.trim()
    private fun run(path: Path, args: List<String>, timeout: Duration = Duration.ofSeconds(45), environment: Map<String, String> = emptyMap(), maxBytes: Long = 2L shl 20) =
        runner.run(ProcessCommand(git ?: fail("GIT_UNAVAILABLE", "Git недоступен"), args, directory = path,
            environment = environment + ("GIT_TERMINAL_PROMPT" to "0"), timeout = timeout, maxOutputBytes = maxBytes,
            allowStderrTruncation = true), ProcessCancellation.NONE)
    private fun requireSuccess(result: ProcessResult) { if (!result.successful) fail("PUBLICATION_FAILED", "Git-операция публикации не выполнена") }
    private fun project(id: String) = projects.get(id) ?: throw ProjectException("PROJECT_NOT_FOUND", "Проект не найден")
    private fun findExecutable(name: String): Path? = System.getenv("PATH").orEmpty().split(System.getProperty("path.separator"))
        .asSequence().filter(String::isNotBlank).map { Path.of(it, name) }.firstOrNull { Files.isRegularFile(it) && Files.isExecutable(it) }
    private fun token(): String = ByteArray(24).also(SecureRandom()::nextBytes).joinToString("") { "%02x".format(it) }
    private fun fail(code: String, message: String): Nothing = throw TaskContextException(code, message)

    private data class Candidate(val task: String, val head: String, val path: Path, val workspaceId: String,
        val paths: List<String>, val diff: String, val excluded: Int, val fingerprint: String)
    private data class StoredPreview(val preview: PublicationPreview, val projectId: String, val workspaceId: String,
        val path: Path, val head: String, val fingerprint: String, val agentDiff: String, val provider: String, val model: String)
    private companion object {
        val PREVIEW_TTL: Duration = Duration.ofMinutes(10)
        const val MAX_AGENT_DIFF = 192 * 1024
        const val MAX_DIFF: Long = 2L * 1024 * 1024
    }
}
