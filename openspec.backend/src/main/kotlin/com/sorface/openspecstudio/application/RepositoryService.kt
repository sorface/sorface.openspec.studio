package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.config.LocalServerProperties
import com.sorface.openspecstudio.domain.project.ContextImportFailure
import com.sorface.openspecstudio.domain.project.ContextImportSummary
import com.sorface.openspecstudio.domain.project.Project
import com.sorface.openspecstudio.domain.project.ProjectException
import com.sorface.openspecstudio.domain.repository.CloneOperation
import com.sorface.openspecstudio.domain.repository.CloneRepositoryCommand
import com.sorface.openspecstudio.domain.repository.OperationEvent
import com.sorface.openspecstudio.domain.repository.RepositoryException
import com.sorface.openspecstudio.domain.repository.RepositoryLink
import com.sorface.openspecstudio.domain.repository.SwitchRepositoryBranchCommand
import com.sorface.openspecstudio.infrastructure.process.ProcessSupervisor
import org.springframework.stereotype.Service
import tools.jackson.databind.ObjectMapper
import java.net.URI
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.time.Duration
import java.time.Instant
import java.util.Locale

/** Оркестрирует изолированные context repositories и clone lifecycle. */
@Service
internal class RepositoryService(
    private val projects: ProjectRepository,
    private val store: RepositoryStore,
    private val runner: ProcessRunner,
    private val supervisor: ProcessSupervisor,
    private val objectMapper: ObjectMapper,
    properties: LocalServerProperties,
) : ContextImporter {
    private val managedRoot = properties.dataDir.resolve("projects").toAbsolutePath().normalize()
    private val git = findExecutable("git")

    fun list(projectId: String): List<RepositoryLink> {
        project(projectId)
        return store.listRepositories(projectId).map { stored ->
            runCatching { inspect(stored.projectId, stored.remoteUrl, scopedRepositoryPath(projectId, stored)) }
                .map { current -> store.updateRepository(current.copy(id = stored.id, createdAt = stored.createdAt)) ?: current }
                .getOrElse { stored.copy(available = false, localBranches = emptyList(), remoteBranches = emptyList()) }
        }
    }

    fun switchBranch(projectId: String, repositoryId: String, command: SwitchRepositoryBranchCommand): RepositoryLink {
        val stored = repository(projectId, repositoryId)
        val path = scopedRepositoryPath(projectId, stored)
        val current = inspect(projectId, stored.remoteUrl, path)
        if (current.dirty) fail("WORKTREE_DIRTY", "В репозитории есть локальные изменения")
        val branch = command.branch.trim().takeIf(String::isNotEmpty)
            ?: fail("GIT_BRANCH_NOT_FOUND", "Выбранная ветка недоступна")
        val arguments = if (command.remote) {
            if (branch !in current.remoteBranches) fail("GIT_BRANCH_NOT_FOUND", "Выбранная ветка недоступна")
            val local = branch.substringAfter('/', "")
            if (local.isBlank()) fail("GIT_BRANCH_NOT_FOUND", "Выбранная ветка недоступна")
            if (local in current.localBranches) fail("GIT_BRANCH_EXISTS", "Локальная ветка уже существует")
            listOf("switch", "--track", "-c", local, branch)
        } else {
            if (branch !in current.localBranches) fail("GIT_BRANCH_NOT_FOUND", "Выбранная ветка недоступна")
            listOf("switch", branch)
        }
        git(path, arguments, Duration.ofSeconds(30)).requireGitSuccess()
        return persistRefresh(stored, path)
    }

    fun update(projectId: String, repositoryId: String): RepositoryLink {
        val stored = repository(projectId, repositoryId)
        val path = scopedRepositoryPath(projectId, stored)
        var current = inspect(projectId, stored.remoteUrl, path)
        if (current.dirty) fail("WORKTREE_DIRTY", "В репозитории есть локальные изменения")
        git(path, listOf("fetch", "--prune"), Duration.ofSeconds(25)).requireGitSuccess()
        current = inspect(projectId, stored.remoteUrl, path)
        if (current.upstream.isBlank()) fail("GIT_UPSTREAM_MISSING", "Для текущей ветки не настроен upstream")
        if (current.ahead > 0 && current.behind > 0) fail("GIT_FAST_FORWARD_REQUIRED", "Ветки разошлись")
        if (current.behind > 0) git(path, listOf("pull", "--ff-only"), Duration.ofSeconds(25)).requireGitSuccess()
        return persistRefresh(stored, path)
    }

    fun startClone(projectId: String, command: CloneRepositoryCommand, correlationId: String): CloneOperation {
        val project = project(projectId)
        val remote = validateGitUrl(command.url)
        if (store.hasActiveOperation(projectId, "repository_clone")) fail("REPOSITORY_CLONE_CONFLICT", "Клонирование уже выполняется")
        val target = createManagedTarget(projectId, remote)
        val input = objectMapper.writeValueAsString(mapOf("url" to remote, "targetPath" to target.toString(), "created" to true))
        val operation = store.createOperation(
            CloneOperation("", projectId, status = "queued", correlationId = correlationId, inputJson = input,
                createdAt = Instant.EPOCH, updatedAt = Instant.EPOCH),
        )
        store.addEvent(operation.id, "queued")
        Thread.ofVirtual().name("repository-clone-${operation.id}").start { runClone(operation, project, remote, target) }
        return operation
    }

    fun get(projectId: String, operationId: String): CloneOperation {
        val operation = store.getOperation(operationId)
            ?.takeIf { it.projectId == projectId && it.kind == "repository_clone" }
            ?: throw ProjectException("PROJECT_NOT_FOUND", "Проект или операция не найдены")
        return operation
    }

    fun cancel(projectId: String, operationId: String): CloneOperation {
        val operation = get(projectId, operationId)
        if (operation.terminal()) return operation
        supervisor.cancel(operation.id)
        return finish(operation, "cancelled")
    }

    fun events(projectId: String, operationId: String, after: Long): List<OperationEvent> {
        get(projectId, operationId)
        return store.listEvents(operationId, after)
    }

    override fun validateRepositories(remotes: List<String>): List<String> = remotes.map { value ->
        runCatching { validateGitUrl(value) }.getOrElse {
            throw ProjectException("INVALID_CONTEXT_REPOSITORY_URL", "Некорректный URL context repository")
        }
    }.distinct()

    override fun import(project: Project, remotes: List<String>): ContextImportSummary {
        val failures = mutableListOf<ContextImportFailure>()
        var imported = 0
        for (remote in remotes) {
            val target = runCatching { createManagedTarget(project.id, remote) }.getOrElse {
                failures += ContextImportFailure(remote, "INVALID_CONTEXT_TARGET", "Не удалось подготовить каталог репозитория")
                continue
            }
            val result = clone(remote, target, ProcessCancellation.NONE)
            if (!result.successful) {
                deleteManagedTarget(target)
                val error = gitError(result)
                failures += ContextImportFailure(remote, error.code, error.message)
                continue
            }
            val link = runCatching { inspect(project.id, remote, target) }.getOrElse {
                deleteManagedTarget(target)
                failures += ContextImportFailure(remote, "INVALID_REPOSITORY", "Каталог не является отдельным Git worktree")
                continue
            }
            runCatching { store.createRepository(link) }.onSuccess { imported++ }.onFailure {
                deleteManagedTarget(target)
                failures += ContextImportFailure(remote, "PERSISTENCE_ERROR", "Не удалось сохранить репозиторий")
            }
        }
        return ContextImportSummary(false, remotes.size, imported, failures)
    }

    private fun runClone(operation: CloneOperation, project: Project, remote: String, target: Path) {
        supervisor.open(operation.id).use { scope ->
            var current = store.updateOperation(operation.copy(status = "running")) ?: return
            store.addEvent(current.id, "running")
            val result = clone(remote, target, scope.cancellation) { chunk ->
                sanitizeProgress(chunk.decodeToString())?.let { message ->
                    store.addEvent(current.id, "progress", objectMapper.writeValueAsString(mapOf("message" to message)))
                }
            }
            if (result.stopReason == "cancelled") {
                deleteManagedTarget(target)
                finish(current, "cancelled")
                return
            }
            if (!result.successful) {
                deleteManagedTarget(target)
                val error = gitError(result)
                finish(current, "failed", error.code, error.message)
                return
            }
            current = store.updateOperation(current.copy(status = "validating")) ?: return
            store.addEvent(current.id, "validating")
            val link = runCatching { inspect(project.id, remote, target) }.getOrElse {
                deleteManagedTarget(target)
                finish(current, "failed", "INVALID_REPOSITORY", "Каталог не является отдельным Git worktree")
                return
            }
            runCatching { store.createRepository(link) }.onSuccess {
                finish(current, "completed")
            }.onFailure {
                deleteManagedTarget(target)
                finish(current, "failed", "PERSISTENCE_ERROR", "Не удалось сохранить репозиторий")
            }
        }
    }

    private fun finish(operation: CloneOperation, status: String, code: String = "", message: String = ""): CloneOperation {
        val current = store.getOperation(operation.id) ?: operation
        if (current.terminal()) return current
        val updated = store.updateOperation(current.copy(status = status, errorCode = code, errorMessage = message)) ?: current
        store.addEvent(updated.id, status, objectMapper.writeValueAsString(mapOf("code" to code, "message" to message)))
        return updated
    }

    private fun inspect(projectId: String, remote: String, target: Path): RepositoryLink {
        val canonical = target.toRealPath()
        val root = gitOutput(canonical, "rev-parse", "--show-toplevel").let(Path::of).toRealPath()
        if (root != canonical) fail("PATH_OUTSIDE_SCOPE", "Целевой путь не разрешён")
        val sha = gitOutput(canonical, "rev-parse", "HEAD")
        val branch = gitOutputOrEmpty(canonical, "branch", "--show-current")
        val upstream = gitOutputOrEmpty(canonical, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
        val divergence = if (upstream.isBlank()) emptyList() else
            gitOutputOrEmpty(canonical, "rev-list", "--left-right", "--count", "HEAD...$upstream").split(Regex("\\s+")).filter(String::isNotBlank)
        val fingerprint = sha256("$canonical\u0000$remote\u0000$sha")
        return RepositoryLink(
            id = "", projectId = projectId, name = remote.trimEnd('/').substringAfterLast('/').substringAfterLast(':').removeSuffix(".git"),
            path = canonical.toString(), remoteUrl = remote, fingerprint = fingerprint, branch = branch, commitSha = sha,
            dirty = gitOutputOrEmpty(canonical, "status", "--porcelain").isNotBlank(), upstream = upstream,
            ahead = divergence.getOrNull(0)?.toIntOrNull() ?: 0, behind = divergence.getOrNull(1)?.toIntOrNull() ?: 0,
            localBranches = gitLines(canonical, "for-each-ref", "--format=%(refname:short)", "refs/heads"),
            remoteBranches = gitLines(canonical, "for-each-ref", "--format=%(refname:short)", "refs/remotes").filterNot { it.endsWith("/HEAD") },
            createdAt = Instant.EPOCH, updatedAt = Instant.EPOCH,
        )
    }

    private fun persistRefresh(stored: RepositoryLink, path: Path): RepositoryLink {
        val current = inspect(stored.projectId, stored.remoteUrl, path).copy(id = stored.id, createdAt = stored.createdAt)
        return store.updateRepository(current) ?: throw ProjectException("PROJECT_NOT_FOUND", "Репозиторий не найден")
    }

    private fun repository(projectId: String, id: String): RepositoryLink {
        project(projectId)
        return store.listRepositories(projectId).firstOrNull { it.id == id }
            ?: throw ProjectException("PROJECT_NOT_FOUND", "Проект или репозиторий не найдены")
    }

    private fun scopedRepositoryPath(projectId: String, stored: RepositoryLink): Path {
        val root = repositoriesRoot(projectId).also(Files::createDirectories).toRealPath()
        val path = runCatching { Path.of(stored.path).toRealPath() }.getOrElse { fail("PATH_OUTSIDE_SCOPE", "Целевой путь не разрешён") }
        if (!path.startsWith(root)) fail("PATH_OUTSIDE_SCOPE", "Целевой путь не разрешён")
        return path
    }

    private fun createManagedTarget(projectId: String, remote: String): Path {
        val root = repositoriesRoot(projectId)
        Files.createDirectories(root)
        val canonical = root.toRealPath()
        val raw = remote.trimEnd('/').substringAfterLast('/').substringAfterLast(':').removeSuffix(".git")
        val prefix = raw.lowercase(Locale.ROOT).replace(Regex("[^a-z0-9._-]+"), "-").trim('.', '-', '_').ifBlank { "repository" }
        return Files.createTempDirectory(canonical, "$prefix-").toRealPath()
    }

    private fun repositoriesRoot(projectId: String): Path = managedRoot.resolve(projectId).resolve("repositories").normalize().also {
        if (!it.startsWith(managedRoot)) fail("PATH_OUTSIDE_SCOPE", "Целевой путь не разрешён")
    }

    private fun clone(remote: String, target: Path, cancellation: ProcessCancellation, stderr: (ByteArray) -> Unit = {}): ProcessResult =
        runner.run(
            ProcessCommand(
                executable = git ?: fail("GIT_UNAVAILABLE", "Git недоступен"),
                arguments = listOf("clone", "--progress", "--", remote, target.toString()),
                directory = target.parent, environment = gitEnvironment(), timeout = Duration.ofMinutes(30),
                maxOutputBytes = 1L shl 20, allowStderrTruncation = true, onStderr = stderr,
            ),
            cancellation,
        )

    private fun git(path: Path, arguments: List<String>, timeout: Duration): ProcessResult = runner.run(
        ProcessCommand(git ?: fail("GIT_UNAVAILABLE", "Git недоступен"), arguments, directory = path,
            environment = gitEnvironment(), timeout = timeout, maxOutputBytes = 1L shl 20, allowStderrTruncation = true),
        ProcessCancellation.NONE,
    )

    private fun ProcessResult.requireGitSuccess() {
        if (!successful) throw gitError(this)
    }

    private fun gitOutput(path: Path, vararg arguments: String): String = git(path, arguments.toList(), Duration.ofSeconds(10)).let {
        if (!it.successful) throw gitError(it)
        it.stdout.trim()
    }

    private fun gitOutputOrEmpty(path: Path, vararg arguments: String): String =
        runCatching { gitOutput(path, *arguments) }.getOrDefault("")

    private fun gitLines(path: Path, vararg arguments: String): List<String> =
        gitOutputOrEmpty(path, *arguments).lineSequence().map(String::trim).filter(String::isNotBlank).toList()

    private fun gitError(result: ProcessResult): RepositoryException {
        val lower = result.stderr.lowercase(Locale.ROOT)
        return when {
            result.stopReason == "timeout" -> RepositoryException("GIT_TIMEOUT", "Git превысил допустимое время")
            "host key verification failed" in lower || "remote host identification has changed" in lower ->
                RepositoryException("SSH_HOST_KEY_FAILED", "Не удалось проверить SSH host key")
            listOf("authentication failed", "permission denied", "could not read username", "publickey", "could not read from remote repository").any(lower::contains) ->
                RepositoryException("GIT_AUTH_FAILED", "Git-аутентификация завершилась ошибкой")
            "repository not found" in lower -> RepositoryException("GIT_REPOSITORY_NOT_FOUND", "Git-репозиторий не найден")
            listOf("not possible to fast-forward", "divergent branches", "non-fast-forward").any(lower::contains) ->
                RepositoryException("GIT_FAST_FORWARD_REQUIRED", "Ветки разошлись")
            else -> RepositoryException("GIT_OPERATION_FAILED", "Git-операция не выполнена")
        }
    }

    private fun validateGitUrl(value: String): String {
        val normalized = value.trim()
        if (normalized.isBlank() || normalized.startsWith('-') || normalized.any { it == '\u0000' || it == '\r' || it == '\n' }) {
            fail("INVALID_GIT_URL", "Некорректный Git URL")
        }
        if (SCP_URL.matches(normalized)) return normalized
        val uri = runCatching { URI(normalized) }.getOrElse { fail("INVALID_GIT_URL", "Некорректный Git URL") }
        if (uri.scheme !in setOf("https", "ssh") || uri.host.isNullOrBlank() || uri.userInfo?.contains(':') == true) {
            fail("INVALID_GIT_URL", "Некорректный Git URL")
        }
        return normalized
    }

    private fun project(id: String): Project = projects.get(id) ?: throw ProjectException("PROJECT_NOT_FOUND", "Проект не найден")

    private fun gitEnvironment(): Map<String, String> = buildMap {
        put("GIT_TERMINAL_PROMPT", "0")
        System.getenv("SSH_AUTH_SOCK")?.trim()?.takeIf(String::isNotEmpty)?.let { put("SSH_AUTH_SOCK", it) }
    }

    private fun deleteManagedTarget(target: Path) {
        if (target.normalize().startsWith(managedRoot) && Files.exists(target)) target.toFile().deleteRecursively()
    }

    private fun findExecutable(name: String): Path? = System.getenv("PATH").orEmpty().split(System.getProperty("path.separator"))
        .asSequence().filter(String::isNotBlank).map { Path.of(it, name) }.firstOrNull { Files.isRegularFile(it) && Files.isExecutable(it) }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
        .joinToString("") { "%02x".format(it) }

    private fun sanitizeProgress(value: String): String? = PROGRESS.find(value)?.value?.replace(Regex("\\s+"), " ")

    private fun fail(code: String, message: String): Nothing = throw RepositoryException(code, message)

    private companion object {
        val SCP_URL = Regex("^[^/@:\\s]+@[^/:\\s]+:[^:\\s].+$")
        val PROGRESS = Regex("(?i)(receiving objects|resolving deltas|counting objects|compressing objects):?\\s*(?:\\d{1,3}%?)?")
    }
}
