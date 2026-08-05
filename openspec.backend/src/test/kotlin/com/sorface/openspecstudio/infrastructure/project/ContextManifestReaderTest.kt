package com.sorface.openspecstudio.infrastructure.project

import com.sorface.openspecstudio.domain.project.ProjectException
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path

@DisplayName("OpenSpec context manifest")
class ContextManifestReaderTest {
    @TempDir
    lateinit var tempDir: Path

    private val reader = ContextManifestReader()

    @Test
    @DisplayName("различает отсутствующий manifest и читает строгий документ")
    fun readsManifest() {
        assertThat(reader.read(tempDir.toString()).found).isFalse()
        Files.createDirectories(tempDir.resolve(".openspec"))
        Files.writeString(
            tempDir.resolve(".openspec/context.yaml"),
            "name: demo\ncontext:\n  repositories: [git@example.com:team/repo.git]\n",
        )

        val result = reader.read(tempDir.toString())

        assertThat(result.found).isTrue()
        assertThat(result.manifest?.name).isEqualTo("demo")
        assertThat(result.manifest?.repositories).containsExactly("git@example.com:team/repo.git")
    }

    @Test
    @DisplayName("отклоняет неизвестные поля и symlink escape")
    fun rejectsUnsafeManifest() {
        Files.createDirectories(tempDir.resolve(".openspec"))
        Files.writeString(tempDir.resolve(".openspec/context.yaml"), "name: demo\ncontext: {repositories: []}\nextra: true\n")
        assertThatThrownBy { reader.read(tempDir.toString()) }
            .isInstanceOf(ProjectException::class.java)

        Files.delete(tempDir.resolve(".openspec/context.yaml"))
        val external = Files.createTempFile("context", ".yaml")
        Files.writeString(external, "name: demo\ncontext: {repositories: []}\n")
        Files.createSymbolicLink(tempDir.resolve(".openspec/context.yaml"), external)
        assertThatThrownBy { reader.read(tempDir.toString()) }
            .isInstanceOf(ProjectException::class.java)
    }
}
