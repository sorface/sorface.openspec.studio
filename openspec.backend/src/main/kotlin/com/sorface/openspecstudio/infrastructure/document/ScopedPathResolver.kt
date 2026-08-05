package com.sorface.openspecstudio.infrastructure.document

import com.sorface.openspecstudio.domain.document.DocumentException
import org.springframework.stereotype.Component
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import kotlin.io.path.extension

data class ResolvedDocument(val root: Path, val relativePath: String, val target: Path)

/** Разрешает только существующие Markdown-файлы в OpenSpec document roots. */
@Component
class ScopedPathResolver {
    fun trustedRoot(storePath: String): Path {
        val requested = runCatching { Path.of(storePath.trim()) }.getOrElse { invalidStore() }
        if (!requested.isAbsolute) invalidStore()
        val root = runCatching { requested.toRealPath() }.getOrElse { invalidStore() }
        if (!Files.isDirectory(root, LinkOption.NOFOLLOW_LINKS)) invalidStore()
        return root
    }

    fun resolveExisting(storePath: String, value: String): ResolvedDocument {
        if (value.isBlank() || '\\' in value) outsideScope()
        val relative = runCatching { Path.of(value) }.getOrElse { outsideScope() }
        if (relative.isAbsolute) outsideScope()
        val normalized = relative.normalize()
        if (normalized.nameCount == 0 || normalized.startsWith("..") || !normalized.extension.equals("md", true)) outsideScope()
        val portable = normalized.joinToString("/")
        if (ALLOWED_ROOTS.none { portable == it || portable.startsWith("$it/") }) outsideScope()
        val root = trustedRoot(storePath)
        val unresolved = root.resolve(normalized).normalize()
        if (!unresolved.startsWith(root)) outsideScope()
        val target = runCatching { unresolved.toRealPath() }.getOrElse {
            if (Files.notExists(unresolved)) throw DocumentException("DOCUMENT_NOT_FOUND", "Документ не найден")
            outsideScope()
        }
        if (!target.startsWith(root) || Files.isSymbolicLink(unresolved) || !Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS)) {
            outsideScope()
        }
        return ResolvedDocument(root, portable, target)
    }

    private fun invalidStore(): Nothing = throw DocumentException("INVALID_STORE", "Исправьте локальный Store проекта")
    private fun outsideScope(): Nothing = throw DocumentException("PATH_OUTSIDE_SCOPE", "Путь документа не разрешён")

    companion object {
        val ALLOWED_ROOTS = listOf("openspec/specs", "openspec/changes", "openspec/archive")
    }
}
