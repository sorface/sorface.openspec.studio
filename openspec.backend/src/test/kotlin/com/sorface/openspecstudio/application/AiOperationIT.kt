package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.config.LocalServerProperties
import com.sorface.openspecstudio.domain.ai.*
import com.sorface.openspecstudio.domain.project.Project
import com.sorface.openspecstudio.domain.project.UpdateProjectCommand
import com.sorface.openspecstudio.domain.repository.*
import com.sorface.openspecstudio.infrastructure.process.ProcessSupervisor
import com.sorface.openspecstudio.infrastructure.process.SafeProcessRunner
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.springframework.beans.factory.support.StaticListableBeanFactory
import tools.jackson.databind.ObjectMapper
import java.nio.file.Files
import java.nio.file.Path
import java.time.Clock
import java.time.Instant
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong

class AiOperationIT {
    @TempDir lateinit var root: Path

    @Test fun `fake cli runs in isolated workspace and operation reaches review with scoped diff`() {
        Files.createDirectories(root.resolve("openspec")); val source = root.resolve("openspec/config.yaml"); Files.writeString(source, "before\n")
        val cli = root.resolve("fake-codex")
        Files.writeString(cli, "#!/bin/sh\nwork=''\nwhile [ \"${'$'}#\" -gt 0 ]; do if [ \"${'$'}1\" = '--cd' ]; then shift; work=\"${'$'}1\"; fi; shift; done\nprintf 'after\\n' > \"${'$'}work/openspec/config.yaml\"\nprintf '%s\\n' '{\"type\":\"item.completed\",\"item\":{\"text\":\"готово\"}}'\n")
        cli.toFile().setExecutable(true)
        val store = MemoryOperations(); val mapper = ObjectMapper()
        val provider = StaticListableBeanFactory().getBeanProvider(ProcessAuditSink::class.java)
        val service = AiOperationService(Projects(root), store, SafeProcessRunner(provider), ProcessSupervisor(), mapper,
            Clock.systemUTC(), LocalServerProperties(dataDir = root.resolve("data")), cli.toString())
        val manifest = service.manifest(ID, ContextManifestCommand())
        val started = service.start(ID, CreateAiOperationCommand(manifest.reviewToken, "Обнови config", "codex", reasoningEffort = "low"), "corr")
        val finished = await(service, started.id)
        assertThat(finished.status).isEqualTo("awaiting_review")
        val result = mapper.readValue(finished.result, AiResult::class.java)
        assertThat(result.finalResponse).isEqualTo("готово")
        assertThat(result.files).hasSize(1)
        assertThat(result.files.single().path).isEqualTo("openspec/config.yaml")
        assertThat(result.files.single().after).isEqualTo("after\n")
        assertThat(source).hasContent("before\n")
        assertThat(store.context).singleElement().extracting("path").isEqualTo("openspec/config.yaml")
        assertThat(service.events(ID, started.id, 0)).extracting("type").contains("queued", "running", "provider_event", "validating", "awaiting_review")
    }

    private fun await(service: AiOperationService, id: String): CloneOperation { repeat(300) { val item = service.get(ID, id); if (item.terminal()) return item; Thread.sleep(10) }; error("timeout") }
    private class Projects(private val path: Path) : ProjectRepository {
        private val p = Project(ID, "Test", path.toString(), createdAt = Instant.EPOCH, updatedAt = Instant.EPOCH)
        override fun list() = listOf(p); override fun get(id: String) = p.takeIf { id == ID }; override fun create(name: String, storePath: String) = error("unused")
        override fun update(id: String, command: UpdateProjectCommand) = null; override fun delete(id: String) = false
    }
    private class MemoryOperations : RepositoryStore {
        private val values = linkedMapOf<String, CloneOperation>(); private val events = mutableListOf<OperationEvent>(); private val sequence = AtomicLong(); var context = emptyList<ContextEntry>()
        override fun listRepositories(projectId: String) = emptyList<RepositoryLink>(); override fun createRepository(item: RepositoryLink) = error("unused"); override fun updateRepository(item: RepositoryLink) = null
        @Synchronized override fun createOperation(item: CloneOperation) = item.copy(id = UUID.randomUUID().toString(), createdAt = Instant.now(), updatedAt = Instant.now()).also { values[it.id] = it }
        @Synchronized override fun getOperation(id: String) = values[id]; @Synchronized override fun updateOperation(item: CloneOperation) = item.copy(updatedAt = Instant.now()).also { values[it.id] = it }
        @Synchronized override fun hasActiveOperation(projectId: String, kind: String) = values.values.any { it.projectId == projectId && it.kind == kind && !it.terminal() }
        @Synchronized override fun addEvent(operationId: String, type: String, payload: String) = OperationEvent(sequence.incrementAndGet(), operationId, type, payload, Instant.now()).also(events::add)
        @Synchronized override fun listEvents(operationId: String, after: Long) = events.filter { it.operationId == operationId && it.sequence > after }
        override fun saveAiContext(operationId: String, entries: List<ContextEntry>) { context = entries }
    }
    private companion object { const val ID = "project-1" }
}
