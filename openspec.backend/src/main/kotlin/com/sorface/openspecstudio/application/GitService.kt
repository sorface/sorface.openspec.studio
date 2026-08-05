package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.domain.git.GitChange
import com.sorface.openspecstudio.domain.git.GitCommitCommand
import com.sorface.openspecstudio.domain.git.GitCreateBranchCommand
import com.sorface.openspecstudio.domain.git.GitException
import com.sorface.openspecstudio.domain.git.GitFetchCommand
import com.sorface.openspecstudio.domain.git.GitOperation
import com.sorface.openspecstudio.domain.git.GitPathsCommand
import com.sorface.openspecstudio.domain.git.GitPushCommand
import com.sorface.openspecstudio.domain.git.GitStatus
import com.sorface.openspecstudio.domain.git.GitSwitchBranchCommand
import com.sorface.openspecstudio.domain.project.ProjectException
import com.sorface.openspecstudio.domain.repository.OperationEvent
import com.sorface.openspecstudio.infrastructure.process.ProcessSupervisor
import org.springframework.stereotype.Service
import tools.jackson.databind.ObjectMapper
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration
import java.time.Instant
import java.util.Locale

/** Управляет Git-состоянием Store и асинхронными fetch/push операциями. */
@Service
internal class GitService(
    private val projects: ProjectRepository,
    private val validator: StoreManager,
    private val store: RepositoryStore,
    private val runner: ProcessRunner,
    private val supervisor: ProcessSupervisor,
    private val objectMapper: ObjectMapper,
) {
    private val git = findExecutable("git")

    fun status(projectId: String): GitStatus = inspect(storePath(projectId))

    fun stage(projectId: String, command: GitPathsCommand): GitStatus {
        val path = storePath(projectId)
        git(path, listOf("add", "-A", "--") + paths(path, command.paths)).requireSuccess()
        return inspect(path)
    }

    fun unstage(projectId: String, command: GitPathsCommand): GitStatus {
        val path = storePath(projectId)
        git(path, listOf("reset", "-q", "HEAD", "--") + paths(path, command.paths)).requireSuccess()
        return inspect(path)
    }

    fun commit(projectId: String, command: GitCommitCommand): GitStatus {
        val path = storePath(projectId)
        val selected = paths(path, command.paths).sorted()
        val message = command.message.trim()
        val subject = message.lineSequence().firstOrNull().orEmpty()
        if (message.length > 16 * 1024 || !CONVENTIONAL.matches(subject)) fail("GIT_INVALID_COMMIT_MESSAGE", "Некорректное conventional commit сообщение")
        if (command.expectedHead.isBlank() || output(path, "rev-parse", "HEAD") != command.expectedHead.trim())
            fail("GIT_HEAD_CHANGED", "HEAD изменился")
        val staged = output(path, "diff", "--cached", "--name-only", "-z", "--")
            .split('\u0000').filter(String::isNotBlank).sorted()
        if (staged.isEmpty() || staged != selected) fail("GIT_INDEX_CHANGED", "Git index изменился")
        git(path, listOf("commit", "-m", message), Duration.ofMinutes(2)).requireSuccess()
        return inspect(path)
    }

    fun createBranch(projectId: String, command: GitCreateBranchCommand): GitStatus {
        val path = storePath(projectId)
        requireClean(path)
        val name = branch(path, command.name)
        if (git(path, listOf("show-ref", "--verify", "--quiet", "refs/heads/$name")).successful)
            fail("GIT_BRANCH_EXISTS", "Ветка уже существует")
        git(path, listOf("switch", "-c", name)).requireSuccess()
        return inspect(path)
    }

    fun switchBranch(projectId: String, command: GitSwitchBranchCommand): GitStatus {
        val path = storePath(projectId)
        requireClean(path)
        if (command.remoteBranch.isBlank()) {
            val name = branch(path, command.branch)
            if (!git(path, listOf("show-ref", "--verify", "--quiet", "refs/heads/$name")).successful)
                fail("GIT_BRANCH_NOT_FOUND", "Ветка не найдена")
            git(path, listOf("switch", name)).requireSuccess()
        } else {
            val remote = command.remoteBranch.trim()
            if (remote.startsWith('-') || remote.any { it == '\u0000' || it == '\r' || it == '\n' } || '/' !in remote)
                fail("GIT_BRANCH_NOT_FOUND", "Ветка не найдена")
            val local = branch(path, command.localBranch)
            if (!git(path, listOf("show-ref", "--verify", "--quiet", "refs/remotes/$remote")).successful)
                fail("GIT_BRANCH_NOT_FOUND", "Ветка не найдена")
            if (git(path, listOf("show-ref", "--verify", "--quiet", "refs/heads/$local")).successful)
                fail("GIT_BRANCH_EXISTS", "Ветка уже существует")
            git(path, listOf("switch", "-c", local, "--track", remote)).requireSuccess()
        }
        return inspect(path)
    }

    fun startFetch(projectId: String, command: GitFetchCommand, correlationId: String): GitOperation {
        val path = storePath(projectId)
        val remote = command.remote.trim()
        if (remote !in inspect(path).remotes) fail("GIT_REMOTE_NOT_FOUND", "Remote не найден")
        return start(projectId, "store_git", mapOf("action" to "fetch", "remote" to remote, "storePath" to path.toString()), correlationId)
    }

    fun startPush(projectId: String, command: GitPushCommand, correlationId: String): GitOperation {
        val path = storePath(projectId)
        val status = inspect(path)
        if (status.detached) fail("GIT_DETACHED_HEAD", "Нельзя выполнить push из detached HEAD")
        val metadata = mutableMapOf("action" to "push", "branch" to status.branch, "storePath" to path.toString())
        if (status.upstream.isBlank()) {
            val remote = command.remote.trim()
            if (remote !in status.remotes) fail("GIT_REMOTE_NOT_FOUND", "Remote не найден")
            metadata["remote"] = remote
            metadata["targetBranch"] = branch(path, command.targetBranch)
        }
        return start(projectId, "store_git", metadata, correlationId)
    }

    fun operation(projectId: String, operationId: String): GitOperation = store.getOperation(operationId)
        ?.takeIf { it.projectId == projectId && it.kind in GIT_KINDS }
        ?.let(::hydrate)
        ?: throw ProjectException("PROJECT_NOT_FOUND", "Проект или операция не найдены")

    fun cancel(projectId: String, operationId: String): GitOperation {
        val operation = operation(projectId, operationId)
        if (operation.terminal()) return operation
        supervisor.cancel(operation.id)
        return finish(operation, "cancelled")
    }

    fun events(projectId: String, operationId: String, after: Long): List<OperationEvent> {
        operation(projectId, operationId)
        return store.listEvents(operationId, after)
    }

    private fun start(projectId: String, kind: String, metadata: Map<String, String>, correlationId: String): GitOperation {
        if (store.hasActiveOperation(projectId, kind)) fail("GIT_OPERATION_CONFLICT", "Git-операция уже выполняется")
        val operation = store.createOperation(GitOperation("", projectId, kind, "queued", correlationId = correlationId,
            inputJson = objectMapper.writeValueAsString(metadata), createdAt = Instant.EPOCH, updatedAt = Instant.EPOCH))
        store.addEvent(operation.id, "queued")
        Thread.ofVirtual().name("$kind-${operation.id}").start { execute(operation, metadata) }
        return hydrate(operation)
    }

    private fun execute(operation: GitOperation, metadata: Map<String, String>) {
        supervisor.open(operation.id).use { scope ->
            val running = store.updateOperation(operation.copy(status = "running")) ?: return
            store.addEvent(running.id, "running")
            val path = Path.of(metadata.getValue("storePath"))
            val arguments = if (metadata.getValue("action") == "fetch") {
                listOf("fetch", "--prune", "--", metadata.getValue("remote"))
            } else if (metadata["remote"].isNullOrBlank()) {
                listOf("push")
            } else {
                listOf("push", "--set-upstream", "--", metadata.getValue("remote"), "HEAD:refs/heads/${metadata.getValue("targetBranch")}")
            }
            val result = run(path, arguments, Duration.ofMinutes(5), scope.cancellation)
            if (result.stopReason == "cancelled") finish(running, "cancelled")
            else if (result.successful) finish(running, "completed")
            else finish(running, "failed", classify(result).code, classify(result).message)
        }
    }

    private fun inspect(path: Path): GitStatus {
        val head = output(path, "rev-parse", "HEAD")
        val currentBranch = outputOrEmpty(path, "symbolic-ref", "--quiet", "--short", "HEAD")
        val upstream = outputOrEmpty(path, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
        val divergence = if (upstream.isBlank()) emptyList() else outputOrEmpty(path, "rev-list", "--left-right", "--count", "HEAD...@{upstream}").split(Regex("\\s+"))
        val raw = run(path, listOf("status", "--porcelain=v1", "-z", "--untracked-files=all"), maxBytes = 256L shl 10).also { it.requireSuccess() }.stdout
        val staged = diff(path, true)
        val unstaged = diff(path, false)
        return GitStatus(currentBranch, currentBranch.isBlank(), head, upstream,
            divergence.getOrNull(0)?.toIntOrNull() ?: 0, divergence.getOrNull(1)?.toIntOrNull() ?: 0,
            lines(path, "for-each-ref", "--format=%(refname:short)", "refs/heads"),
            lines(path, "for-each-ref", "--format=%(refname:lstrip=2)", "refs/remotes").filterNot { it.endsWith("/HEAD") },
            lines(path, "remote"), parseStatus(raw), buildString {
                if (staged.first.isNotBlank()) append("# Staged\n").append(staged.first)
                if (unstaged.first.isNotBlank()) { if (isNotEmpty()) append('\n'); append("# Unstaged\n").append(unstaged.first) }
            }, staged.second || unstaged.second)
    }

    private fun diff(path: Path, staged: Boolean): Pair<String, Boolean> {
        val args = buildList { add("diff"); if (staged) add("--cached"); addAll(listOf("--no-ext-diff", "--no-color", "--")) }
        val result = run(path, args, maxBytes = 512L shl 10)
        if (!result.successful && result.stopReason != "output_limit") throw classify(result)
        return result.stdout to (result.stopReason == "output_limit")
    }

    private fun parseStatus(raw: String): List<GitChange> {
        val records = raw.split('\u0000')
        val result = mutableListOf<GitChange>()
        var index = 0
        while (index < records.size) {
            val record = records[index]
            if (record.length >= 4) {
                var path = record.substring(3)
                if ((record[0] in "RC" || record[1] in "RC") && index + 1 < records.size && records[index + 1].isNotBlank()) path = records[++index]
                result += GitChange(path, record[0].toString(), record[1].toString())
            }
            index++
        }
        return result
    }

    private fun storePath(projectId: String): Path {
        val project = projects.get(projectId) ?: throw ProjectException("PROJECT_NOT_FOUND", "Проект не найден")
        return Path.of(validator.validate(project.storePath)).toRealPath()
    }

    private fun paths(root: Path, values: List<String>): List<String> {
        if (values.isEmpty()) fail("GIT_EMPTY_SELECTION", "Не выбраны файлы")
        return values.map { value ->
            val clean = value.trim().replace('\\', '/')
            if (clean.isBlank() || clean.startsWith('/') || clean.startsWith('-') || clean.any { it == '\u0000' || it == '\r' || it == '\n' })
                fail("INVALID_STORE_PATH", "Некорректный путь")
            val resolved = root.resolve(clean).normalize()
            if (!resolved.startsWith(root) || Files.isSymbolicLink(resolved)) fail("INVALID_STORE_PATH", "Некорректный путь")
            root.relativize(resolved).toString()
        }.distinct()
    }

    private fun branch(path: Path, value: String): String {
        val name = value.trim()
        if (name.isBlank() || name.startsWith('-') || name.any { it == '\u0000' || it == '\r' || it == '\n' }) fail("GIT_INVALID_BRANCH", "Некорректная ветка")
        if (!git(path, listOf("check-ref-format", "--branch", name)).successful) fail("GIT_INVALID_BRANCH", "Некорректная ветка")
        return name
    }

    private fun requireClean(path: Path) { if (inspect(path).changes.isNotEmpty()) fail("WORKTREE_DIRTY", "Git worktree содержит изменения") }
    private fun output(path: Path, vararg args: String): String = git(path, args.toList()).also { it.requireSuccess() }.stdout.trim()
    private fun outputOrEmpty(path: Path, vararg args: String) = runCatching { output(path, *args) }.getOrDefault("")
    private fun lines(path: Path, vararg args: String) = outputOrEmpty(path, *args).lineSequence().map(String::trim).filter(String::isNotBlank).toList()
    private fun git(path: Path, args: List<String>, timeout: Duration = Duration.ofSeconds(30)) = run(path, args, timeout)
    private fun run(path: Path, args: List<String>, timeout: Duration = Duration.ofSeconds(30), cancellation: ProcessCancellation = ProcessCancellation.NONE, maxBytes: Long = 1L shl 20) =
        runner.run(ProcessCommand(git ?: fail("GIT_UNAVAILABLE", "Git недоступен"), args, directory = path, environment = gitEnvironment(), timeout = timeout,
            maxOutputBytes = maxBytes, allowStderrTruncation = true), cancellation)
    private fun ProcessResult.requireSuccess() { if (!successful) throw classify(this) }
    private fun classify(result: ProcessResult): GitException {
        val error = result.stderr.lowercase(Locale.ROOT)
        return when {
            result.stopReason == "timeout" -> GitException("GIT_TIMEOUT", "Git превысил допустимое время")
            "authentication failed" in error || "permission denied" in error || "publickey" in error -> GitException("GIT_AUTH_FAILED", "Git-аутентификация завершилась ошибкой")
            "non-fast-forward" in error || "fetch first" in error -> GitException("GIT_NON_FAST_FORWARD", "Push не является fast-forward")
            else -> GitException("GIT_OPERATION_FAILED", "Git-операция не выполнена")
        }
    }
    private fun finish(operation: GitOperation, status: String, code: String = "", message: String = ""): GitOperation {
        val current = store.getOperation(operation.id) ?: operation
        if (current.terminal()) return current
        val updated = store.updateOperation(current.copy(status = status, errorCode = code, errorMessage = message)) ?: current
        store.addEvent(updated.id, status, objectMapper.writeValueAsString(mapOf("code" to code, "message" to message)))
        return hydrate(updated)
    }
    private fun hydrate(operation: GitOperation): GitOperation {
        val metadata = runCatching { objectMapper.readTree(operation.inputJson) }.getOrNull()
        val branch = metadata?.path("branch")?.asText().orEmpty().ifBlank { metadata?.path("targetBranch")?.asText().orEmpty() }
        return operation.copy(
            gitAction = metadata?.path("action")?.asText().orEmpty(),
            gitRemote = metadata?.path("remote")?.asText().orEmpty(),
            gitBranch = branch,
        )
    }
    private fun gitEnvironment() = buildMap { put("GIT_TERMINAL_PROMPT", "0"); System.getenv("SSH_AUTH_SOCK")?.takeIf(String::isNotBlank)?.let { put("SSH_AUTH_SOCK", it) } }
    private fun findExecutable(name: String): Path? = System.getenv("PATH").orEmpty().split(System.getProperty("path.separator")).asSequence()
        .filter(String::isNotBlank).map { Path.of(it, name) }.firstOrNull { Files.isRegularFile(it) && Files.isExecutable(it) }
    private fun fail(code: String, message: String): Nothing = throw GitException(code, message)

    private companion object {
        val CONVENTIONAL = Regex("^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\\([a-z0-9][a-z0-9._/-]*\\))?!?: .{1,200}$")
        val GIT_KINDS = setOf("store_git")
    }
}
