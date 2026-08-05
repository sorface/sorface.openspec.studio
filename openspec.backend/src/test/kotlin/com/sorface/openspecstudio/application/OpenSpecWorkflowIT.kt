package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.domain.openspec.*
import com.sorface.openspecstudio.domain.project.Project
import com.sorface.openspecstudio.domain.project.UpdateProjectCommand
import com.sorface.openspecstudio.domain.repository.CloneOperation
import com.sorface.openspecstudio.domain.repository.OperationEvent
import com.sorface.openspecstudio.domain.repository.RepositoryLink
import com.sorface.openspecstudio.infrastructure.process.ProcessSupervisor
import com.sorface.openspecstudio.infrastructure.process.SafeProcessRunner
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.springframework.beans.factory.support.StaticListableBeanFactory
import tools.jackson.databind.ObjectMapper
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong

@DisplayName("OpenSpec workflow на реальном CLI")
class OpenSpecWorkflowIT {
    @TempDir lateinit var root:Path
    private lateinit var workflow:OpenSpecService
    private lateinit var actions:OpenSpecActionService
    private lateinit var operationStore:MemoryOperationStore

    @BeforeEach fun prepare(){
        command("openspec","init","--tools","none","--no-animation",root.toString())
        val projects=FixedProjects(root);val runner=SafeProcessRunner(StaticListableBeanFactory().getBeanProvider(ProcessAuditSink::class.java));val mapper=ObjectMapper()
        workflow=OpenSpecService(projects,runner,mapper);operationStore=MemoryOperationStore();actions=OpenSpecActionService(workflow,operationStore,operationStore,ProcessSupervisor(),mapper)
    }

    @Test fun `читает CLI overview details validation и безопасно удаляет change`(){
        command("openspec","new","change","demo-change","--json",directory=root)
        val overview=workflow.overview(PROJECT)
        assertThat(overview.capability.supported).isTrue()
        assertThat(overview.changes.map{it.name}).contains("demo-change")
        val details=workflow.details(PROJECT,"demo-change")
        assertThat(details.actions.map{it.kind}).contains("prepare_artifact","archive")
        assertThat(details.deletion.files).isNotEmpty()
        val validation=workflow.validate(PROJECT,"demo-change")
        assertThat(validation.valid).isFalse()
        assertThatThrownBy{workflow.delete(PROJECT,"demo-change",DeleteChangeCommand("wrong",details.fingerprint))}.isInstanceOf(OpenSpecException::class.java)
        val deleted=workflow.delete(PROJECT,"demo-change",DeleteChangeCommand("demo-change",details.fingerprint))
        assertThat(deleted.deleted).isTrue();assertThat(root.resolve("openspec/changes/demo-change")).doesNotExist()
    }

    @Test fun `создаёт review draft принимает и атомарно записывает proposal`(){
        val operation=actions.start(PROJECT,CreateOpenSpecActionCommand("create_change",change="new-capability",proposal="# Proposal\n"),"correlation")
        val ready=await(operation.id)
        assertThat(ready.status).isEqualTo("awaiting_review")
        val draft=actions.accept(PROJECT,operation.id)
        assertThat(draft.status).isEqualTo("accepted")
        val written=actions.write(PROJECT,draft.id)
        assertThat(written.status).isEqualTo("written")
        assertThat(Files.readString(root.resolve("openspec/changes/new-capability/proposal.md"))).isEqualTo("# Proposal\n")
        assertThat(actions.events(PROJECT,operation.id,0).map{it.type}).containsExactly("queued","running","awaiting_review")
    }

    @Test
    @DisplayName("отклоняет некорректное имя change до создания review-операции")
    fun rejectsInvalidChangeNameBeforeCreatingOperation() {
        listOf("has spaces", "..", "with/slash", "Uppercase", "a".repeat(121)).forEach { change ->
            assertThatThrownBy {
                actions.start(PROJECT, CreateOpenSpecActionCommand("create_change", change = change, proposal = "draft"), "")
            }.isInstanceOf(OpenSpecException::class.java)
                .extracting("code").isEqualTo("OPENSPEC_CHANGE_INVALID")
        }

        assertThat(root.resolve("openspec/changes/Uppercase/proposal.md")).doesNotExist()
    }

    @Test
    @DisplayName("не запускает архивирование незавершённого change")
    fun rejectsArchiveForIncompleteChange() {
        command("openspec", "new", "change", "incomplete-change", "--json", directory = root)
        val archive = workflow.details(PROJECT, "incomplete-change").actions.single { it.kind == "archive" }

        assertThat(archive.available).isFalse()
        assertThatThrownBy {
            actions.start(PROJECT, CreateOpenSpecActionCommand("archive", change = "incomplete-change"), "")
        }.isInstanceOf(OpenSpecException::class.java)
            .extracting("code").isEqualTo("OPENSPEC_ACTION_BLOCKED")
        assertThat(root.resolve("openspec/changes/incomplete-change")).exists()
    }

    @Test fun `обнаруживает draft conflict и поддерживает reject`(){
        val first=actions.start(PROJECT,CreateOpenSpecActionCommand("create_change",change="conflict-change",proposal="draft"),"")
        val ready=await(first.id);val set=actions.accept(PROJECT,ready.id)
        Files.createDirectories(root.resolve("openspec/changes/conflict-change"));Files.writeString(root.resolve("openspec/changes/conflict-change/proposal.md"),"external")
        assertThatThrownBy{actions.write(PROJECT,set.id)}.isInstanceOf(OpenSpecException::class.java).extracting("code").isEqualTo("OPENSPEC_DRAFT_CONFLICT")
        Files.delete(root.resolve("openspec/changes/conflict-change/proposal.md"));Files.delete(root.resolve("openspec/changes/conflict-change"))
        val second=actions.start(PROJECT,CreateOpenSpecActionCommand("create_change",change="rejected-change",proposal="draft"),"")
        assertThat(actions.reject(PROJECT,await(second.id).id).status).isEqualTo("rejected")
    }

    @Test
    @DisplayName("подготавливает proposal через generator и оставляет Store неизменным до принятия")
    fun preparesArtifactThroughReviewWorkflow() {
        command("openspec","new","change","agent-change","--json",directory=root)
        val details = workflow.details(PROJECT, "agent-change")
        val generator = OpenSpecArtifactGenerator { request, _ ->
            val path = "openspec/changes/${request.change}/proposal.md"
            OpenSpecArtifactGenerationResult("Proposal подготовлен", listOf(FileMutation("create", path, after = "# Updated proposal\n")))
        }
        val service = OpenSpecActionService(workflow, operationStore, operationStore, ProcessSupervisor(), ObjectMapper(), generator)

        val operation = service.start(PROJECT, CreateOpenSpecActionCommand(
            kind = "prepare_artifact", change = "agent-change", artifact = "proposal", goal = "Обнови proposal",
            provider = "codex", model = "gpt-5.4-mini", statusFingerprint = details.fingerprint,
        ), "correlation")
        val ready = await(service, operation.id)

        assertThat(ready.status).isEqualTo("awaiting_review")
        assertThat(ready.result).contains("Proposal подготовлен", "# Updated proposal")
        assertThat(root.resolve("openspec/changes/agent-change/proposal.md")).doesNotExist()
        assertThat(service.events(PROJECT, operation.id, 0).map { it.type }).containsExactly("queued", "running", "validating", "awaiting_review")
    }

    @Test
    @DisplayName("возвращает структурированный explore в awaiting_review")
    fun exploresIntentThroughStructuredReview() {
        val explorer = OpenSpecExplorer { _, _ ->
            ExplorationResult(
                state = "proposal_ready",
                summary = "Proposal подготовлен",
                proposal = "## Why\nНужно изменение.\n",
                suggestedNames = listOf("add-json-export"),
            )
        }
        val service = OpenSpecActionService(
            workflow, operationStore, operationStore, ProcessSupervisor(), ObjectMapper(), explorer = explorer,
        )

        val operation = service.start(PROJECT, CreateOpenSpecActionCommand(
            kind = "explore", goal = "Добавить JSON export", provider = "codex", model = "gpt-5.4-mini",
        ), "correlation")
        val ready = await(service, operation.id)

        assertThat(ready.status).isEqualTo("awaiting_review")
        assertThat(ready.result).contains("proposal_ready", "add-json-export", "Proposal подготовлен")
        assertThat(service.events(PROJECT, operation.id, 0).map { it.type }).containsExactly("queued", "running", "awaiting_review")
    }

    private fun await(id:String):CloneOperation=await(actions,id)
    private fun await(service:OpenSpecActionService,id:String):CloneOperation{repeat(400){val value=service.get(PROJECT,id);if(value.terminal())return value;Thread.sleep(25)};error("operation timeout")}
    private fun command(vararg args:String,directory:Path=root){val process=ProcessBuilder(args.toList()).directory(directory.toFile()).redirectErrorStream(true).start();val output=process.inputStream.bufferedReader().readText();check(process.waitFor()==0){output}}
    private class FixedProjects(path:Path):ProjectRepository{private val item=Project(PROJECT,"OpenSpec",path.toString(),createdAt=Instant.EPOCH,updatedAt=Instant.EPOCH);override fun list()=listOf(item);override fun get(id:String)=item.takeIf{id==PROJECT};override fun create(name:String,storePath:String)=error("unused");override fun update(id:String,command:UpdateProjectCommand)=error("unused");override fun delete(id:String)=false}
    private class MemoryOperationStore:RepositoryStore,OpenSpecOperationStore{
        private val operations=linkedMapOf<String,CloneOperation>();private val events=mutableListOf<OperationEvent>();private val sets=linkedMapOf<String,DraftSet>();private val sequence=AtomicLong()
        override fun listRepositories(projectId:String):List<RepositoryLink> = emptyList();override fun createRepository(item:RepositoryLink)=error("unused");override fun updateRepository(item:RepositoryLink):RepositoryLink?=null
        @Synchronized override fun createOperation(item:CloneOperation)=item.copy(id=UUID.randomUUID().toString(),createdAt=Instant.now(),updatedAt=Instant.now()).also{operations[it.id]=it}
        @Synchronized override fun getOperation(id:String)=operations[id];@Synchronized override fun updateOperation(item:CloneOperation)=item.copy(updatedAt=Instant.now()).also{operations[it.id]=it}
        @Synchronized override fun hasActiveOperation(projectId:String,kind:String)=operations.values.any{it.projectId==projectId&&it.kind==kind&&!it.terminal()}
        @Synchronized override fun addEvent(operationId:String,type:String,payload:String)=OperationEvent(sequence.incrementAndGet(),operationId,type,payload,Instant.now()).also(events::add)
        @Synchronized override fun listEvents(operationId:String,after:Long)=events.filter{it.operationId==operationId&&it.sequence>after}
        override fun list(projectId:String,change:String)=operations.values.filter{it.projectId==projectId&&it.openspecChange==change}.toList()
        override fun saveDraft(set:DraftSet)=set.copy(id=UUID.randomUUID().toString(),createdAt=Instant.now(),updatedAt=Instant.now()).also{sets[it.id]=it}
        override fun getDraft(id:String)=sets[id];override fun getDraftByOperation(operationId:String)=sets.values.firstOrNull{it.operationId==operationId}
        override fun updateDraftStatus(id:String,status:String)=sets[id]?.copy(status=status,updatedAt=Instant.now())?.also{sets[id]=it}
    }
    private companion object{const val PROJECT="openspec-project"}
}
