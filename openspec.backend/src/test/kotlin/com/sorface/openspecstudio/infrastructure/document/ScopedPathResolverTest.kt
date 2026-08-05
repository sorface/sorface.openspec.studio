package com.sorface.openspecstudio.infrastructure.document

import com.sorface.openspecstudio.domain.document.DocumentException
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path

@DisplayName("Безопасное разрешение document path")
class ScopedPathResolverTest {
    @TempDir lateinit var root: Path
    private val resolver = ScopedPathResolver()

    @Test
    @DisplayName("разрешает Markdown только в OpenSpec roots")
    fun resolvesAllowedDocument() {
        val document = root.resolve("openspec/specs/auth/spec.md")
        Files.createDirectories(document.parent)
        Files.writeString(document, "# Auth")

        val resolved = resolver.resolveExisting(root.toString(), "openspec/specs/auth/spec.md")

        assertThat(resolved.target).isEqualTo(document.toRealPath())
        assertThat(resolved.relativePath).isEqualTo("openspec/specs/auth/spec.md")
    }

    @Test
    @DisplayName("отклоняет traversal, чужой root и symlink")
    fun rejectsEscapes() {
        val outside = Files.createTempFile("secret", ".md")
        val link = root.resolve("openspec/changes/demo/proposal.md")
        Files.createDirectories(link.parent)
        Files.createSymbolicLink(link, outside)

        listOf("../secret.md", "README.md", "/tmp/secret.md", "openspec\\specs\\x.md", "openspec/changes/demo/proposal.md")
            .forEach { unsafe ->
                assertThatThrownBy { resolver.resolveExisting(root.toString(), unsafe) }
                    .isInstanceOf(DocumentException::class.java)
                    .extracting("code").isEqualTo("PATH_OUTSIDE_SCOPE")
            }
    }
}
