package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.domain.document.DocumentAnnotation
import com.sorface.openspecstudio.domain.document.DocumentContent
import com.sorface.openspecstudio.domain.document.DocumentException
import com.sorface.openspecstudio.domain.document.DocumentHistoryEntry
import com.sorface.openspecstudio.domain.document.DocumentItem
import com.sorface.openspecstudio.domain.document.WriteDocumentCommand
import com.sorface.openspecstudio.domain.project.ProjectException
import com.sorface.openspecstudio.infrastructure.document.ScopedPathResolver
import org.springframework.stereotype.Service
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.security.MessageDigest
import java.time.Instant
import java.time.Duration
import kotlin.io.path.name

/** Document list/read/write/history/annotations use cases. */
@Service
internal class DocumentService(
    private val projects: ProjectRepository,
    private val resolver: ScopedPathResolver,
    private val processRunner: ProcessRunner,
) {
    fun list(projectId: String): List<DocumentItem> {
        val root = projectRoot(projectId)
        val items = mutableListOf<DocumentItem>()
        for (allowed in ScopedPathResolver.ALLOWED_ROOTS) {
            val start = root.resolve(allowed)
            if (!Files.isDirectory(start, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(start)) continue
            val paths = Files.walk(start)
            try {
                paths.forEach { path ->
                    if (Files.isSymbolicLink(path)) return@forEach
                    val relative = root.relativize(path).joinToString("/")
                    when {
                        Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS) ->
                            items += DocumentItem(relative, path.name, "directory")
                        Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) && path.name.endsWith(".md", true) ->
                            items += DocumentItem(relative, path.name, "file")
                    }
                }
            } finally {
                paths.close()
            }
        }
        return items.sortedWith(compareBy<DocumentItem>({ sortKey(it.path) }, { it.kind }))
    }

    fun read(projectId: String, path: String): DocumentContent {
        val resolved = resolver.resolveExisting(projectPath(projectId), path)
        val bytes = readBytes(resolved.target)
        return DocumentContent(resolved.relativePath, decode(bytes), sha256(bytes))
    }

    fun write(projectId: String, command: WriteDocumentCommand): DocumentContent {
        val encoder = StandardCharsets.UTF_8.newEncoder()
            .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
        if (!encoder.canEncode(command.content)) invalidContent()
        val bytes = command.content.toByteArray(StandardCharsets.UTF_8)
        if (bytes.size > MAX_DOCUMENT_SIZE) tooLarge()
        val resolved = resolver.resolveExisting(projectPath(projectId), command.path)
        val current = readBytes(resolved.target)
        if (command.baseContentHash.isBlank() || sha256(current) != command.baseContentHash) {
            throw DocumentException("DRAFT_CONFLICT", "Документ был изменён вне редактора")
        }
        atomicWrite(resolved.target, bytes)
        return DocumentContent(resolved.relativePath, command.content, sha256(bytes))
    }

    fun history(projectId: String, path: String): List<DocumentHistoryEntry> {
        val resolved = resolver.resolveExisting(projectPath(projectId), path)
        val git = gitExecutable() ?: throw ProjectException("GIT_UNAVAILABLE", "Git недоступен")
        if (!runGit(git, resolved.root, listOf("rev-parse", "--verify", "HEAD"), 10, 64 shl 10).successful) {
            return emptyList()
        }
        val result = runGit(
            git,
            resolved.root,
            listOf(
                "log", "--follow", "--max-count=100",
                "--format=%H%x1f%h%x1f%aN%x1f%aI%x1f%s%x1e", "--", resolved.relativePath,
            ),
            30,
            256 shl 10,
        )
        if (!result.successful) throw DocumentException("INVALID_STORE", "Исправьте локальный Store проекта")
        return result.output.split('\u001e').mapNotNull { raw ->
            val fields = raw.trim().split('\u001f', limit = 5)
            fields.takeIf { it.size == 5 }?.let {
                DocumentHistoryEntry(it[0], it[1], it[2], it[3], it[4])
            }
        }
    }

    fun annotations(projectId: String, path: String): List<DocumentAnnotation> {
        val resolved = resolver.resolveExisting(projectPath(projectId), path)
        val git = gitExecutable() ?: throw ProjectException("GIT_UNAVAILABLE", "Git недоступен")
        val head = runGit(git, resolved.root, listOf("rev-parse", "--verify", "HEAD"), 10, 64 shl 10)
        val tracked = head.successful && runGit(
            git,
            resolved.root,
            listOf("cat-file", "-e", "HEAD:${resolved.relativePath}"),
            10,
            64 shl 10,
        ).successful
        if (!tracked) return localAnnotations(resolved.target)
        val result = runGit(
            git,
            resolved.root,
            listOf("blame", "--line-porcelain", "--", resolved.relativePath),
            30,
            16 shl 20,
        )
        if (!result.successful) throw DocumentException("INVALID_STORE", "Исправьте локальный Store проекта")
        return groupBlame(parseBlame(result.output))
    }

    private fun projectPath(id: String): String = projects.get(id)?.storePath
        ?: throw ProjectException("PROJECT_NOT_FOUND", "Проект не найден")

    private fun projectRoot(id: String): Path = resolver.trustedRoot(projectPath(id))

    private fun readBytes(path: Path): ByteArray {
        if (Files.size(path) > MAX_DOCUMENT_SIZE) tooLarge()
        return Files.readAllBytes(path).also { if (it.size > MAX_DOCUMENT_SIZE) tooLarge() }
    }

    private fun decode(bytes: ByteArray): String = runCatching {
        StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
    }.getOrElse { invalidContent() }

    private fun atomicWrite(target: Path, bytes: ByteArray) {
        val temp = Files.createTempFile(target.parent, ".openspec-studio-", ".tmp")
        try {
            runCatching { Files.setPosixFilePermissions(temp, Files.getPosixFilePermissions(target)) }
            Files.newByteChannel(temp, StandardOpenOption.WRITE).use { channel ->
                channel.write(ByteBuffer.wrap(bytes))
                (channel as? java.nio.channels.FileChannel)?.force(true)
            }
            try {
                Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            } catch (_: AtomicMoveNotSupportedException) {
                Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING)
            }
        } finally {
            Files.deleteIfExists(temp)
        }
    }

    private fun sortKey(path: String): String {
        val parts = path.split('/')
        if (parts.size < 4 || parts[0] != "openspec" || parts[1] != "changes") return path
        val rank = when (parts[3]) {
            "proposal.md" -> "0"
            "spec", "specs" -> "1"
            "design.md" -> "2"
            "tasks.md" -> "3"
            else -> "4-${parts[3]}"
        }
        return parts.take(3).joinToString("/") + "/$rank/" + parts.drop(3).joinToString("/")
    }

    private data class GitResult(val output: String, val successful: Boolean)

    private fun runGit(
        executable: Path,
        directory: Path,
        arguments: List<String>,
        timeoutSeconds: Long,
        maxBytes: Int,
    ): GitResult {
        val result = processRunner.run(
            ProcessCommand(
                executable = executable,
                arguments = arguments,
                directory = directory,
                timeout = Duration.ofSeconds(timeoutSeconds),
                maxOutputBytes = maxBytes.toLong(),
            ),
            ProcessCancellation.NONE,
        )
        return GitResult(result.stdout, result.successful)
    }

    private data class BlameLine(
        var line: Int,
        var hash: String,
        var author: String = "",
        var email: String = "",
        var authoredAt: String = "",
        var subject: String = "",
        var content: String = "",
    )

    private fun parseBlame(output: String): List<BlameLine> {
        val result = mutableListOf<BlameLine>()
        var current: BlameLine? = null
        for (raw in output.lineSequence()) {
            if (raw.startsWith('\t')) {
                current?.apply { content = raw.removePrefix("\t") }?.also(result::add)
                current = null
                continue
            }
            val header = BLAME_HEADER.matchEntire(raw)
            if (header != null) {
                current = BlameLine(header.groupValues[3].toInt(), header.groupValues[1])
                continue
            }
            current?.let { line ->
                when {
                    raw.startsWith("author ") -> line.author = raw.removePrefix("author ")
                    raw.startsWith("author-mail ") -> line.email = raw.removePrefix("author-mail ").trim('<', '>')
                    raw.startsWith("author-time ") -> raw.removePrefix("author-time ").toLongOrNull()
                        ?.takeIf { it > 0 }?.let { line.authoredAt = Instant.ofEpochSecond(it).toString() }
                    raw.startsWith("summary ") -> line.subject = raw.removePrefix("summary ")
                }
            }
        }
        return result
    }

    private fun groupBlame(lines: List<BlameLine>): List<DocumentAnnotation> {
        val entries = mutableListOf<DocumentAnnotation>()
        for (line in lines) {
            val local = line.hash.isNotEmpty() && line.hash.all { it == '0' }
            val hash = if (local) "" else line.hash
            val author = if (local) "Локальные изменения" else line.author
            val subject = if (local) "Ещё не сохранено в Git" else line.subject
            val previous = entries.lastOrNull()
            if (previous != null && previous.endLine + 1 == line.line && previous.hash == hash &&
                previous.author == author && previous.subject == subject && previous.authoredAt == line.authoredAt
            ) {
                entries[entries.lastIndex] = previous.copy(endLine = line.line, lines = previous.lines + line.content)
            } else {
                entries += DocumentAnnotation(
                    startLine = line.line,
                    endLine = line.line,
                    hash = hash,
                    shortHash = if (local) "" else hash.take(8),
                    author = author,
                    authorEmail = if (local) "" else line.email,
                    authoredAt = if (local) "" else line.authoredAt,
                    subject = subject,
                    lines = listOf(line.content),
                    local = local,
                )
            }
        }
        return entries
    }

    private fun localAnnotations(path: Path): List<DocumentAnnotation> {
        val content = decode(readBytes(path)).removeSuffix("\n")
        if (content.isEmpty()) return emptyList()
        val lines = content.split('\n')
        return listOf(
            DocumentAnnotation(1, lines.size, author = "Локальные изменения", subject = "Ещё не сохранено в Git", lines = lines, local = true),
        )
    }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes).joinToString("") { "%02x".format(it) }

    private fun invalidContent(): Nothing =
        throw DocumentException("INVALID_DOCUMENT_CONTENT", "Документ должен содержать корректный UTF-8 Markdown")

    private fun tooLarge(): Nothing =
        throw DocumentException("DOCUMENT_TOO_LARGE", "Документ превышает допустимый размер")

    private fun gitExecutable(): Path? = System.getenv("PATH").orEmpty()
        .split(System.getProperty("path.separator")).asSequence()
        .filter(String::isNotBlank).map { Path.of(it, "git") }
        .firstOrNull { Files.isRegularFile(it) && Files.isExecutable(it) }

    private companion object {
        const val MAX_DOCUMENT_SIZE = 2 shl 20
        val BLAME_HEADER = Regex("^([0-9a-f]{40,}) (\\d+) (\\d+)(?: \\d+)?$")
    }
}
