package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.domain.document.DocumentException
import com.sorface.openspecstudio.domain.document.WriteDocumentCommand
import com.sorface.openspecstudio.domain.project.Project
import com.sorface.openspecstudio.domain.project.UpdateProjectCommand
import com.sorface.openspecstudio.infrastructure.document.ScopedPathResolver
import com.sorface.openspecstudio.infrastructure.process.SafeProcessRunner
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant
import org.springframework.beans.factory.support.StaticListableBeanFactory

@DisplayName("Document use cases")
class DocumentServiceTest {
    @TempDir
    lateinit var store: Path

    private lateinit var service: DocumentService

    @BeforeEach
    fun setUp() {
        service = DocumentService(FixedProjectRepository(store), ScopedPathResolver(), processRunner())
    }

    @Test
    fun `перечисляет только Markdown и применяет порядок change artifacts`() {
        write("openspec/changes/demo/tasks.md", "tasks")
        write("openspec/changes/demo/proposal.md", "proposal")
        write("openspec/changes/demo/specs/auth/spec.md", "spec")
        write("openspec/changes/demo/ignore.txt", "ignored")

        val files = service.list(PROJECT_ID).filter { it.kind == "file" }.map { it.path }

        assertThat(files).containsExactly(
            "openspec/changes/demo/proposal.md",
            "openspec/changes/demo/specs/auth/spec.md",
            "openspec/changes/demo/tasks.md",
        )
    }

    @Test
    fun `читает хеш и атомарно записывает документ по base hash`() {
        val target = write("openspec/specs/auth/spec.md", "before")
        val initial = service.read(PROJECT_ID, "openspec/specs/auth/spec.md")

        val saved = service.write(
            PROJECT_ID,
            WriteDocumentCommand(initial.path, "after", initial.contentHash),
        )

        assertThat(saved.content).isEqualTo("after")
        assertThat(saved.contentHash).isNotEqualTo(initial.contentHash)
        assertThat(Files.readString(target)).isEqualTo("after")
        assertThatThrownBy {
            service.write(PROJECT_ID, WriteDocumentCommand(initial.path, "stale", initial.contentHash))
        }.isInstanceOf(DocumentException::class.java).extracting("code").isEqualTo("DRAFT_CONFLICT")
    }

    @Test
    fun `отклоняет oversized и повреждённый UTF-8 document`() {
        val large = write("openspec/specs/large.md", "x")
        Files.write(large, ByteArray((2 shl 20) + 1))
        val invalid = store.resolve("openspec/specs/invalid.md")
        Files.write(invalid, byteArrayOf(0xC3.toByte(), 0x28))

        assertThatThrownBy { service.read(PROJECT_ID, "openspec/specs/large.md") }
            .extracting("code").isEqualTo("DOCUMENT_TOO_LARGE")
        assertThatThrownBy { service.read(PROJECT_ID, "openspec/specs/invalid.md") }
            .extracting("code").isEqualTo("INVALID_DOCUMENT_CONTENT")
    }

    @Test
    fun `возвращает локальные annotations без Git history`() {
        write("openspec/specs/auth/spec.md", "first\nsecond\n")

        assertThat(service.history(PROJECT_ID, "openspec/specs/auth/spec.md")).isEmpty()
        val annotations = service.annotations(PROJECT_ID, "openspec/specs/auth/spec.md")
        assertThat(annotations).hasSize(1)
        assertThat(annotations.single().local).isTrue()
        assertThat(annotations.single().lines).containsExactly("first", "second")
    }

    @Test
    fun `читает Git history и группирует blame`() {
        val relative = "openspec/specs/auth/spec.md"
        write(relative, "first\nsecond\n")
        git("init")
        git("config", "user.name", "Test Author")
        git("config", "user.email", "author@example.test")
        git("add", relative)
        git("commit", "-m", "Add auth specification")

        val history = service.history(PROJECT_ID, relative)
        val annotations = service.annotations(PROJECT_ID, relative)

        assertThat(history).hasSize(1)
        assertThat(history.single().author).isEqualTo("Test Author")
        assertThat(history.single().subject).isEqualTo("Add auth specification")
        assertThat(annotations).hasSize(1)
        assertThat(annotations.single().local).isFalse()
        assertThat(annotations.single().author).isEqualTo("Test Author")
        assertThat(annotations.single().lines).containsExactly("first", "second")
    }

    private fun write(relative: String, content: String): Path = store.resolve(relative).also {
        Files.createDirectories(it.parent)
        Files.writeString(it, content, StandardCharsets.UTF_8)
    }

    private fun git(vararg arguments: String) {
        val process = ProcessBuilder(listOf("git", "-C", store.toString()) + arguments).redirectErrorStream(true).start()
        val output = process.inputStream.bufferedReader().readText()
        check(process.waitFor() == 0) { output }
    }

    private fun processRunner(): ProcessRunner = SafeProcessRunner(
        StaticListableBeanFactory().getBeanProvider(ProcessAuditSink::class.java),
    )

    private class FixedProjectRepository(private val store: Path) : ProjectRepository {
        private val project = Project(PROJECT_ID, "Test", store.toString(), createdAt = Instant.EPOCH, updatedAt = Instant.EPOCH)
        override fun list(): List<Project> = listOf(project)
        override fun get(id: String): Project? = project.takeIf { id == PROJECT_ID }
        override fun create(name: String, storePath: String): Project = error("not used")
        override fun update(id: String, command: UpdateProjectCommand): Project? = error("not used")
        override fun delete(id: String): Boolean = false
    }

    private companion object {
        const val PROJECT_ID = "project-1"
    }
}
