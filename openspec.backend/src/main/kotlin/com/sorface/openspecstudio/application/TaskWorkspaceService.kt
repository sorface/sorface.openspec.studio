package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.config.LocalServerProperties
import com.sorface.openspecstudio.domain.project.Project
import com.sorface.openspecstudio.domain.project.ProjectException
import com.sorface.openspecstudio.domain.taskcontext.OpenTaskWorkspaceCommand
import com.sorface.openspecstudio.domain.taskcontext.TaskSyncResult
import com.sorface.openspecstudio.domain.taskcontext.TaskWorkspace
import com.sorface.openspecstudio.domain.taskcontext.TaskWorkspaceOverview
import com.sorface.openspecstudio.domain.taskcontext.TaskContextException
import org.springframework.stereotype.Service
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration
import java.time.Instant
import java.util.UUID

/** Управляет изолированными Git worktree для веток задач. */
@Service
internal class TaskWorkspaceService(
    private val projects: ProjectRepository,
    private val workspaces: TaskWorkspaceRepository,
    private val runner: ProcessRunner,
    properties: LocalServerProperties,
) {
    private val git = findExecutable("git")
    private val managedRoot = properties.dataDir.resolve("task-worktrees")

    fun list(projectId: String): TaskWorkspaceOverview {
        val project = project(projectId)
        ensureBase(project)
        val items = workspaces.list(projectId).map { it.copy(dirty = outputOrEmpty(Path.of(it.path), "status", "--porcelain=v1", "--untracked-files=normal").isNotBlank()) }
        val local = lines(Path.of(project.baseStorePath), "for-each-ref", "--format=%(refname:short)", "refs/heads").sorted()
        val remote = lines(Path.of(project.baseStorePath), "for-each-ref", "--format=%(refname:short)", "refs/remotes/origin")
            .filter { it.startsWith("origin/") && it != "origin/HEAD" }.sorted()
        return TaskWorkspaceOverview(items, local, remote, items.firstOrNull(TaskWorkspace::active))
    }

    fun open(projectId: String, command: OpenTaskWorkspaceCommand): TaskWorkspaceOverview {
        val project = project(projectId)
        val (branch, remote) = resolveBranch(Path.of(project.baseStorePath), command)
        ensureBase(project)
        workspaces.findByBranch(projectId, branch)?.let {
            validate(project, it)
            if (!workspaces.activate(projectId, it.id)) fail("TASK_WORKSPACE_NOT_FOUND", "Рабочее пространство не найдено")
            return list(projectId)
        }
        val id = UUID.randomUUID().toString().replace("-", "")
        val target = managedRoot.resolve(projectId).resolve(id).toAbsolutePath().normalize()
        Files.createDirectories(target.parent)
        val base = Path.of(project.baseStorePath)
        val localExists = success(base, "show-ref", "--verify", "--quiet", "refs/heads/$branch")
        val arguments = when {
            remote.isNotBlank() && !localExists -> listOf("worktree", "add", "-b", branch, "--track", "--", target.toString(), remote)
            localExists -> listOf("worktree", "add", "--", target.toString(), branch)
            success(base, "show-ref", "--verify", "--quiet", "refs/remotes/origin/$branch") ->
                listOf("worktree", "add", "-b", branch, "--track", "--", target.toString(), "origin/$branch")
            else -> listOf("worktree", "add", "-b", branch, "--", target.toString(), "HEAD")
        }
        val result = run(base, arguments, Duration.ofSeconds(90))
        if (!result.successful) {
            if ("already checked out" in result.stderr.lowercase()) fail("TASK_WORKSPACE_CONFLICT", "Ветка уже открыта")
            fail("TASK_WORKSPACE_UNAVAILABLE", "Не удалось открыть worktree")
        }
        val workspace = TaskWorkspace(id, projectId, branch, target.toString(), true, createdAt = Instant.EPOCH, updatedAt = Instant.EPOCH)
        try {
            validate(project, workspace)
            workspaces.create(workspace)
            if (!workspaces.activate(projectId, id)) fail("TASK_WORKSPACE_NOT_FOUND", "Рабочее пространство не найдено")
        } catch (exception: Exception) {
            run(base, listOf("worktree", "remove", "--force", "--", target.toString()), Duration.ofSeconds(30))
            throw exception
        }
        return list(projectId)
    }

    fun sync(projectId: String): TaskSyncResult {
        val project = project(projectId)
        val active = list(projectId).active ?: fail("TASK_WORKSPACE_UNAVAILABLE", "Активный worktree отсутствует")
        validate(project, active)
        val path = Path.of(active.path)
        val before = output(path, "rev-parse", "HEAD")
        val result = run(path, listOf("pull", "--ff-only", "--no-rebase"), Duration.ofMinutes(2))
        if (!result.successful) {
            val message = (result.stdout + '\n' + result.stderr).lowercase()
            when {
                "no tracking information" in message || "has no upstream branch" in message || "upstream branch" in message && "does not exist" in message ->
                    fail("TASK_SYNC_UPSTREAM_UNAVAILABLE", "Upstream не настроен")
                "would be overwritten" in message || "local changes" in message || "not possible to fast-forward" in message || "cannot fast-forward" in message ->
                    fail("TASK_SYNC_CONFLICT", "Remote изменения конфликтуют")
                else -> fail("TASK_SYNC_FAILED", "Не удалось синхронизировать ветку")
            }
        }
        val head = output(path, "rev-parse", "HEAD")
        return TaskSyncResult(active.branch, head != before, before, head)
    }

    private fun ensureBase(project: Project): TaskWorkspace {
        val base = Path.of(project.baseStorePath).toRealPath()
        val branch = output(base, "branch", "--show-current").ifBlank { fail("TASK_WORKSPACE_UNAVAILABLE", "Detached HEAD") }
        workspaces.findByBranch(project.id, branch)?.let { validate(project, it); return it }
        val workspace = workspaces.create(TaskWorkspace("", project.id, branch, base.toString(), false,
            createdAt = Instant.EPOCH, updatedAt = Instant.EPOCH))
        if (project.activeWorktreeId == null && !workspaces.activate(project.id, workspace.id))
            fail("TASK_WORKSPACE_NOT_FOUND", "Проект не найден")
        return workspace
    }

    private fun validate(project: Project, workspace: TaskWorkspace) {
        val path = runCatching { Path.of(workspace.path).toRealPath() }.getOrElse { fail("TASK_WORKSPACE_UNAVAILABLE", "Worktree недоступен") }
        if (!Files.isDirectory(path) || Files.isSymbolicLink(Path.of(workspace.path))) fail("TASK_WORKSPACE_UNAVAILABLE", "Worktree недоступен")
        if (Path.of(output(path, "rev-parse", "--show-toplevel")).toRealPath() != path) fail("TASK_WORKSPACE_UNAVAILABLE", "Некорректный worktree")
        if (output(path, "branch", "--show-current") != workspace.branch) fail("TASK_WORKSPACE_CONFLICT", "Ветка worktree изменилась")
        if (commonDir(path) != commonDir(Path.of(project.baseStorePath))) fail("TASK_WORKSPACE_CONFLICT", "Worktree относится к другому Store")
    }

    private fun commonDir(path: Path): Path {
        val value = Path.of(output(path, "rev-parse", "--git-common-dir"))
        return (if (value.isAbsolute) value else path.resolve(value)).normalize().toRealPath()
    }
    private fun resolveBranch(path: Path, command: OpenTaskWorkspaceCommand): Pair<String, String> {
        val local = command.branch.trim(); val remote = command.remoteBranch.trim()
        if ((local.isBlank()) == (remote.isBlank())) fail("TASK_BRANCH_INVALID", "Укажите одну ветку")
        if (remote.isNotBlank()) {
            if (!remote.startsWith("origin/") || remote == "origin/HEAD") fail("TASK_BRANCH_INVALID", "Некорректная remote ветка")
            if (!success(path, "show-ref", "--verify", "--quiet", "refs/remotes/$remote")) fail("TASK_REMOTE_BRANCH_NOT_FOUND", "Remote ветка не найдена")
            return validBranch(path, remote.removePrefix("origin/")) to remote
        }
        return validBranch(path, local) to ""
    }
    private fun validBranch(path: Path, value: String): String {
        if (value.isBlank() || value.startsWith('-') || value.any { it == '\u0000' || it == '\r' || it == '\n' } ||
            !success(path, "check-ref-format", "--branch", value)) fail("TASK_BRANCH_INVALID", "Некорректная ветка")
        return value
    }
    private fun project(id: String) = projects.get(id) ?: throw ProjectException("PROJECT_NOT_FOUND", "Проект не найден")
    private fun output(path: Path, vararg args: String): String = run(path, args.toList()).also {
        if (!it.successful) fail(if (git == null) "GIT_UNAVAILABLE" else "TASK_WORKSPACE_UNAVAILABLE", "Git команда не выполнена")
    }.stdout.trim()
    private fun outputOrEmpty(path: Path, vararg args: String) = runCatching { output(path, *args) }.getOrDefault("")
    private fun lines(path: Path, vararg args: String) = output(path, *args).lineSequence().map(String::trim).filter(String::isNotBlank).toList()
    private fun success(path: Path, vararg args: String) = run(path, args.toList()).successful
    private fun run(path: Path, args: List<String>, timeout: Duration = Duration.ofSeconds(15)) = runner.run(ProcessCommand(
        git ?: fail("GIT_UNAVAILABLE", "Git недоступен"), args, directory = path, timeout = timeout,
        maxOutputBytes = 128L shl 10, allowStderrTruncation = true,
        environment = mapOf("GIT_TERMINAL_PROMPT" to "0", "LC_ALL" to "C"),
    ), ProcessCancellation.NONE)
    private fun findExecutable(name: String): Path? = System.getenv("PATH").orEmpty().split(System.getProperty("path.separator"))
        .asSequence().filter(String::isNotBlank).map { Path.of(it, name) }.firstOrNull { Files.isRegularFile(it) && Files.isExecutable(it) }
    private fun fail(code: String, message: String): Nothing = throw TaskContextException(code, message)
}
