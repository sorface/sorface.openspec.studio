package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.config.LocalServerProperties
import com.sorface.openspecstudio.domain.ai.*
import com.sorface.openspecstudio.domain.project.ProjectException
import com.sorface.openspecstudio.domain.repository.CloneOperation
import com.sorface.openspecstudio.domain.repository.OperationEvent
import com.sorface.openspecstudio.infrastructure.process.ProcessSupervisor
import org.springframework.stereotype.Service
import org.springframework.beans.factory.annotation.Value
import tools.jackson.databind.ObjectMapper
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap

/** Запускает Agent CLI только над проверенным изолированным снимком контекста. */
@Service
internal class AiOperationService(
    private val projects: ProjectRepository,
    private val repositories: RepositoryStore,
    private val runner: ProcessRunner,
    private val supervisor: ProcessSupervisor,
    private val mapper: ObjectMapper,
    private val clock: Clock,
    properties: LocalServerProperties,
    @Value("\${ai.cli.path:}") private val configuredCli: String = "",
) {
    private val dataDir = properties.dataDir.resolve("operations")
    private val manifests = ConcurrentHashMap<String, ReviewedManifest>()

    fun manifest(projectId: String, command: ContextManifestCommand): ContextManifest {
        val project = projects.get(projectId) ?: throw ProjectException("PROJECT_NOT_FOUND", "Проект не найден")
        val roots = repositories.listRepositories(projectId).associate { it.id to Path.of(it.path) } + ("store" to Path.of(project.storePath))
        val intents = command.files.ifEmpty { listOf(ContextIntent("store", "openspec/config.yaml")) }
        if (intents.size > MAX_FILES) fail("INVALID_AI_CONTEXT", "Слишком много файлов")
        var total = 0L
        val resolved = intents.map { intent ->
            val entry = resolve(roots[intent.source], intent)
            if (!entry.entry.included) entry else {
                total += entry.entry.size
                if (total > MAX_TOTAL) entry.exclude("TOTAL_LIMIT_EXCEEDED") else entry
            }
        }
        val token = token()
        val expires = Instant.now(clock).plus(TTL)
        manifests.entries.removeIf { !it.value.expiresAt.isAfter(Instant.now(clock)) }
        manifests[token] = ReviewedManifest(projectId, resolved, expires)
        return ContextManifest(token, resolved.map(ResolvedEntry::entry), expires,
            mapOf("maxFiles" to MAX_FILES.toLong(), "maxFileBytes" to MAX_FILE_BYTES, "maxTotalBytes" to MAX_TOTAL))
    }

    fun start(projectId: String, input: CreateAiOperationCommand, correlationId: String): CloneOperation {
        if (input.prompt.isBlank() || input.reasoningEffort !in setOf("", "low")) fail("INVALID_AI_CONTEXT", "Контекст не разрешён")
        val manifest = manifests.remove(input.reviewToken.trim())
            ?.takeIf { it.projectId == projectId && it.expiresAt.isAfter(Instant.now(clock)) }
            ?: fail("AI_CONTEXT_STALE", "Контекст устарел")
        val included = manifest.entries.filter { it.entry.included }
        if (included.isEmpty()) fail("INVALID_AI_CONTEXT", "Нет разрешённых файлов")
        included.forEach { if (!same(it)) fail("AI_CONTEXT_STALE", "Контекст изменился") }
        provider(input.provider)
        if (repositories.hasActiveOperation(projectId, "ai")) fail("AI_OPERATION_CONFLICT", "AI-операция уже выполняется")
        val created = repositories.createOperation(CloneOperation(
            id = "", projectId = projectId, kind = "ai", status = "queued", provider = input.provider.lowercase(),
            model = input.model, prompt = input.prompt, inputJson = mapper.writeValueAsString(mapOf("reasoningEffort" to input.reasoningEffort)),
            correlationId = correlationId, createdAt = Instant.EPOCH, updatedAt = Instant.EPOCH,
        ))
        repositories.saveAiContext(created.id, manifest.entries.map(ResolvedEntry::entry))
        repositories.addEvent(created.id, "queued")
        Thread.ofVirtual().name("ai-${created.id}").start { run(created, included, input.reasoningEffort) }
        return created
    }

    fun get(projectId: String, id: String): CloneOperation = repositories.getOperation(id)
        ?.takeIf { it.projectId == projectId && it.kind == "ai" }
        ?: throw ProjectException("PROJECT_NOT_FOUND", "Операция не найдена")

    fun cancel(projectId: String, id: String): CloneOperation {
        val item = get(projectId, id)
        if (item.terminal()) return item
        supervisor.cancel(id)
        return finish(item, "cancelled")
    }

    fun events(projectId: String, id: String, after: Long): List<OperationEvent> {
        get(projectId, id)
        return repositories.listEvents(id, after)
    }

    private fun run(operation: CloneOperation, entries: List<ResolvedEntry>, effort: String) {
        supervisor.open(operation.id).use { scope ->
            var current = repositories.updateOperation(operation.copy(status = "running")) ?: return
            repositories.addEvent(current.id, "running")
            val root = dataDir.resolve(current.id)
            val baseline = root.resolve("baseline")
            val working = root.resolve("working")
            try {
                Files.createDirectories(baseline); Files.createDirectories(working)
                entries.filter { it.entry.source == "store" }.forEach { copy(it, baseline); copy(it, working) }
                val executable = provider(current.provider)
                val arguments = arguments(current.provider, current.model, effort, working)
                val result = runner.run(ProcessCommand(executable, arguments, directory = working,
                    stdin = envelope(current.prompt, entries), timeout = Duration.ofMinutes(10), operationId = current.id), scope.cancellation)
                if (!result.successful) {
                    val status = if (result.stopReason == "cancelled") "cancelled" else "failed"
                    val code = when (result.stopReason) { "timeout" -> "AI_TIMEOUT"; "output_limit" -> "AI_OUTPUT_LIMIT_EXCEEDED"; "cancelled" -> ""; else -> "AI_PROVIDER_FAILED" }
                    finish(current, status, code, if (code.isBlank()) "" else "Agent CLI завершился с ошибкой")
                    return
                }
                result.stdout.lineSequence().filter(String::isNotBlank).forEach { line ->
                    val type = runCatching { mapper.readTree(line).path("type").asText("provider_event") }.getOrDefault("provider_diagnostic")
                    repositories.addEvent(current.id, "provider_event", mapper.writeValueAsString(mapOf("providerType" to type)))
                }
                current = repositories.updateOperation(current.copy(status = "validating")) ?: current
                repositories.addEvent(current.id, "validating")
                entries.forEach { if (!same(it)) fail("AI_SCOPE_VIOLATION", "Исходный контекст изменён") }
                val files = audit(baseline, working)
                val response = finalResponse(result.stdout)
                finish(current, "awaiting_review", result = mapper.writeValueAsString(AiResult(response, files)))
            } catch (exception: AiException) {
                finish(current, "failed", exception.code, exception.message)
            } catch (_: Exception) {
                finish(current, "failed", "AI_WORKSPACE_FAILED", "AI workspace недоступен")
            } finally {
                root.toFile().deleteRecursively()
            }
        }
    }

    private fun resolve(root: Path?, intent: ContextIntent): ResolvedEntry {
        val normalized = intent.path.replace('\\', '/')
        fun excluded(reason: String) = ResolvedEntry(ContextEntry(intent.source, normalized, reason = reason, included = false))
        if (root == null || normalized.isBlank() || Path.of(normalized).isAbsolute || normalized.split('/').contains("..")) return excluded("PATH_OUTSIDE_SCOPE")
        if (denied(normalized)) return excluded("DENYLIST")
        return runCatching {
            val canonicalRoot = root.toRealPath()
            val candidate = canonicalRoot.resolve(normalized).normalize().toRealPath()
            if (!candidate.startsWith(canonicalRoot) || !Files.isRegularFile(candidate, LinkOption.NOFOLLOW_LINKS)) return excluded("PATH_OUTSIDE_SCOPE")
            val bytes = Files.readAllBytes(candidate)
            if (bytes.size > MAX_FILE_BYTES) return excluded("FILE_TOO_LARGE")
            if (bytes.take(8000).any { it.toInt() == 0 }) return excluded("BINARY_FILE")
            ResolvedEntry(ContextEntry(intent.source, normalized, bytes.size.toLong(), sha(bytes), "selected", true), candidate, bytes)
        }.getOrElse { excluded("FILE_UNAVAILABLE") }
    }

    private fun copy(entry: ResolvedEntry, root: Path) {
        val target = root.resolve(entry.entry.path).normalize()
        if (!target.startsWith(root)) fail("AI_SCOPE_VIOLATION", "Недопустимый путь")
        Files.createDirectories(target.parent); Files.write(target, entry.content)
    }

    private fun audit(baseline: Path, working: Path): List<AiFileDiff> {
        val paths = linkedSetOf<String>()
        listOf(baseline, working).forEach { root ->
            Files.walk(root).use { stream ->
                stream.filter { it != root }.forEach { candidate ->
                    if (Files.isSymbolicLink(candidate) || (!Files.isDirectory(candidate) && !Files.isRegularFile(candidate, LinkOption.NOFOLLOW_LINKS))) {
                        fail("AI_SCOPE_VIOLATION", "В workspace обнаружен недопустимый объект")
                    }
                    if (Files.isRegularFile(candidate, LinkOption.NOFOLLOW_LINKS)) {
                        paths += root.relativize(candidate).toString().replace('\\', '/')
                    }
                }
            }
        }
        return paths.sorted().mapNotNull { name ->
            if (denied(name)) fail("AI_SCOPE_VIOLATION", "Запрещённый путь")
            val before = baseline.resolve(name).takeIf(Files::exists)?.let(Files::readString).orEmpty()
            val afterPath = working.resolve(name)
            if (Files.isSymbolicLink(afterPath)) fail("AI_SCOPE_VIOLATION", "Symlink запрещён")
            val after = afterPath.takeIf(Files::exists)?.let(Files::readString).orEmpty()
            if (after.toByteArray().size > MAX_FILE_BYTES) fail("AI_SCOPE_VIOLATION", "Файл слишком большой")
            AiFileDiff(name, before, after).takeIf { before != after }
        }
    }

    private fun provider(name: String): Path {
        val normalized = name.trim().lowercase()
        if (normalized !in setOf("codex", "gigacode")) fail("AI_PROVIDER_UNSUPPORTED", "Provider не поддерживается")
        configuredCli.trim().takeIf(String::isNotBlank)?.let { configured ->
            val path = Path.of(configured).toAbsolutePath()
            if (Files.isRegularFile(path) && Files.isExecutable(path)) return path
            fail("AI_PROVIDER_UNAVAILABLE", "Agent CLI недоступен")
        }
        return System.getenv("PATH").orEmpty().split(System.getProperty("path.separator")).asSequence()
            .map { Path.of(it, normalized) }.firstOrNull { Files.isRegularFile(it) && Files.isExecutable(it) }
            ?: fail("AI_PROVIDER_UNAVAILABLE", "Agent CLI недоступен")
    }

    private fun arguments(provider: String, model: String, effort: String, working: Path): List<String> {
        if (model.startsWith("-") || (model.isNotBlank() && !MODEL.matches(model))) fail("AI_PROVIDER_UNSUPPORTED", "Model не поддерживается")
        val args = if (provider == "codex") mutableListOf("exec", "--json", "--ephemeral", "--sandbox", "workspace-write", "--skip-git-repo-check", "--cd", working.toString())
            else mutableListOf("--non-interactive", "--json", "--cwd", working.toString())
        if (effort == "low" && provider == "codex") args += listOf("--config", "model_reasoning_effort=\"low\"")
        if (model.isNotBlank()) args += listOf("--model", model)
        args += "-"
        return args
    }

    private fun envelope(prompt: String, entries: List<ResolvedEntry>) = buildString {
        append("Работай только с файлами текущего изолированного OpenSpec workspace. Не изменяй context-файлы.\n\nЗАДАЧА:\n$prompt\n\nКОНТЕКСТ:\n")
        entries.filter { it.entry.source != "store" }.forEach { append("\n--- source=${it.entry.source} path=${it.entry.path} sha256=${it.entry.checksum} ---\n${it.content.toString(Charsets.UTF_8)}\n") }
    }

    private fun finalResponse(output: String): String = output.lineSequence().mapNotNull { line -> runCatching {
        val node = mapper.readTree(line); node.path("message").asText().ifBlank { node.path("item").path("text").asText() }.takeIf(String::isNotBlank)
    }.getOrNull() }.lastOrNull() ?: "Agent CLI завершил операцию."

    private fun same(entry: ResolvedEntry) = runCatching { sha(Files.readAllBytes(entry.absolute!!)) == entry.entry.checksum }.getOrDefault(false)
    private fun finish(item: CloneOperation, status: String, code: String = "", message: String = "", result: String = item.result): CloneOperation {
        val current = repositories.getOperation(item.id) ?: item
        if (current.terminal()) return current
        val updated = repositories.updateOperation(current.copy(status = status, errorCode = code, errorMessage = message, result = result)) ?: current
        repositories.addEvent(item.id, status, mapper.writeValueAsString(mapOf("code" to code, "message" to message)))
        return updated
    }
    private fun denied(path: String): Boolean { val value = path.lowercase(); val base = Path.of(value).fileName.toString(); return value.startsWith(".git/") || value.contains("/.git/") || base == ".env" || base.startsWith(".env.") || base.endsWith(".pem") || base.endsWith(".key") || base.contains("secret") || base.contains("credential") }
    private fun sha(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun token() = ByteArray(24).also(SecureRandom()::nextBytes).joinToString("") { "%02x".format(it) }
    private fun fail(code: String, message: String): Nothing = throw AiException(code, message)
    private data class ReviewedManifest(val projectId: String, val entries: List<ResolvedEntry>, val expiresAt: Instant)
    private data class ResolvedEntry(val entry: ContextEntry, val absolute: Path? = null, val content: ByteArray = byteArrayOf()) { fun exclude(reason: String) = copy(entry = entry.copy(size = 0, checksum = "", reason = reason, included = false), absolute = null, content = byteArrayOf()) }
    private companion object { const val MAX_FILES = 100; const val MAX_FILE_BYTES = 1L shl 20; const val MAX_TOTAL = 4L shl 20; val TTL: Duration = Duration.ofMinutes(10); val MODEL = Regex("^[A-Za-z0-9._:/-]{1,100}$") }
}
