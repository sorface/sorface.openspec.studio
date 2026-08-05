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
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant
import org.springframework.beans.factory.support.StaticListableBeanFactory

@DisplayName("Document service на реальном filesystem и Git")
class DocumentServiceIT {
    @TempDir lateinit var root: Path
    private lateinit var service: DocumentService
    private lateinit var document: Path

    @BeforeEach
    fun prepare() {
        document = root.resolve("openspec/changes/demo/proposal.md")
        Files.createDirectories(document.parent)
        Files.writeString(document, "# Original\n")
        git("init")
        git("add", ".")
        git("-c", "user.name=API Test", "-c", "user.email=api@example.com", "commit", "-m", "add proposal")
        service = DocumentService(FixedProjectRepository(root), ScopedPathResolver(), processRunner())
    }

    @Test
    @DisplayName("читает, сортирует, пишет атомарно и обнаруживает conflict")
    fun readsAndWrites() {
        val path = "openspec/changes/demo/proposal.md"
        assertThat(service.list("project").map { it.path }).contains(path)
        val original = service.read("project", path)

        val updated = service.write("project", WriteDocumentCommand(path, "# Updated\n", original.contentHash))

        assertThat(updated.content).isEqualTo("# Updated\n")
        assertThat(Files.readString(document)).isEqualTo("# Updated\n")
        assertThat(root.resolve("openspec/changes/demo").toFile().listFiles().orEmpty().map { it.name })
            .doesNotContainAnyElementsOf(listOf(".openspec-studio-"))
        assertThatThrownBy { service.write("project", WriteDocumentCommand(path, "again", original.contentHash)) }
            .isInstanceOf(DocumentException::class.java)
            .extracting("code").isEqualTo("DRAFT_CONFLICT")
    }

    @Test
    @DisplayName("возвращает Git history и blame, включая локальные строки")
    fun returnsHistoryAndAnnotations() {
        val path = "openspec/changes/demo/proposal.md"
        val history = service.history("project", path).single()
        assertThat(history.author).isEqualTo("API Test")
        assertThat(history.subject).isEqualTo("add proposal")
        val annotation = service.annotations("project", path).single()
        assertThat(annotation.author).isEqualTo("API Test")
        assertThat(annotation.lines).containsExactly("# Original")

        Files.writeString(document, "# Local\n")
        assertThat(service.annotations("project", path)).anySatisfy { assertThat(it.local).isTrue() }
    }

    @Test
    @DisplayName("отклоняет большой и некорректный UTF-8 document")
    fun rejectsInvalidContent() {
        val path = "openspec/changes/demo/proposal.md"
        val current = service.read("project", path)
        assertThatThrownBy { service.write("project", WriteDocumentCommand(path, "x".repeat((2 shl 20) + 1), current.contentHash)) }
            .isInstanceOf(DocumentException::class.java)
            .extracting("code").isEqualTo("DOCUMENT_TOO_LARGE")
        Files.write(document, byteArrayOf(0xC3.toByte(), 0x28))
        assertThatThrownBy { service.read("project", path) }
            .isInstanceOf(DocumentException::class.java)
            .extracting("code").isEqualTo("INVALID_DOCUMENT_CONTENT")
    }

    private fun git(vararg arguments: String) {
        val process = ProcessBuilder(listOf("git", "-C", root.toString()) + arguments).redirectErrorStream(true).start()
        val output = process.inputStream.bufferedReader().readText()
        check(process.waitFor() == 0) { output }
    }

    private fun processRunner(): ProcessRunner = SafeProcessRunner(
        StaticListableBeanFactory().getBeanProvider(ProcessAuditSink::class.java),
    )

    private class FixedProjectRepository(root: Path) : ProjectRepository {
        private val project = Project("project", "Documents", root.toString(), createdAt = Instant.EPOCH, updatedAt = Instant.EPOCH)
        override fun list() = listOf(project)
        override fun get(id: String) = project.takeIf { id == project.id }
        override fun create(name: String, storePath: String) = error("unused")
        override fun update(id: String, command: UpdateProjectCommand) = error("unused")
        override fun delete(id: String) = false
    }
}
