package com.sorface.openspecstudio.infrastructure.project

import com.sorface.openspecstudio.domain.project.ContextManifest
import com.sorface.openspecstudio.domain.project.ProjectException
import org.springframework.stereotype.Component
import org.yaml.snakeyaml.LoaderOptions
import org.yaml.snakeyaml.Yaml
import org.yaml.snakeyaml.constructor.SafeConstructor
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.nio.file.attribute.BasicFileAttributes

data class ContextManifestResult(val manifest: ContextManifest?, val found: Boolean)

/** Безопасно читает ограниченный `.openspec/context.yaml`. */
@Component
class ContextManifestReader {
    fun read(storePath: String): ContextManifestResult {
        val root = runCatching { Path.of(storePath).toRealPath() }.getOrElse { invalid(false) }
        val path = root.resolve(".openspec/context.yaml")
        if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS)) return ContextManifestResult(null, false)
        val attributes = runCatching {
            Files.readAttributes(path, BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS)
        }.getOrElse { invalid(true) }
        if (!attributes.isRegularFile || attributes.isSymbolicLink || attributes.size() > MAX_SIZE) invalid(true)
        val canonical = runCatching { path.toRealPath() }.getOrElse { invalid(true) }
        if (!canonical.startsWith(root)) invalid(true)
        val content = runCatching { Files.readString(canonical) }.getOrElse { invalid(true) }
        if (content.toByteArray().size > MAX_SIZE) invalid(true)

        val options = LoaderOptions().apply {
            isAllowDuplicateKeys = false
            maxAliasesForCollections = 10
            nestingDepthLimit = 20
            codePointLimit = MAX_SIZE
        }
        val documents = runCatching { Yaml(SafeConstructor(options)).loadAll(content).toList() }
            .getOrElse { invalid(true) }
        if (documents.size != 1) invalid(true)
        val document = documents.single() as? Map<*, *> ?: invalid(true)
        if (document.keys != setOf("name", "context")) invalid(true)
        val name = (document["name"] as? String)?.trim().orEmpty()
        val context = document["context"] as? Map<*, *> ?: invalid(true)
        if (name.isEmpty() || context.keys != setOf("repositories")) invalid(true)
        val rawRepositories = context["repositories"] as? List<*> ?: invalid(true)
        if (rawRepositories.size > MAX_REPOSITORIES) invalid(true)
        val repositories = rawRepositories.map { (it as? String)?.trim().orEmpty() }
        if (repositories.any(String::isEmpty)) invalid(true)
        return ContextManifestResult(ContextManifest(name, repositories), true)
    }

    private fun invalid(found: Boolean): Nothing =
        throw ProjectException("INVALID_CONTEXT_MANIFEST", "Файл .openspec/context.yaml имеет некорректный формат")

    private companion object {
        const val MAX_SIZE = 256 shl 10
        const val MAX_REPOSITORIES = 100
    }
}
