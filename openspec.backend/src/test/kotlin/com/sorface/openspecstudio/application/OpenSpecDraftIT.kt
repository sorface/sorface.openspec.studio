package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.domain.openspec.*
import com.sorface.openspecstudio.domain.project.Project
import com.sorface.openspecstudio.domain.project.UpdateProjectCommand
import com.sorface.openspecstudio.domain.repository.*
import com.sorface.openspecstudio.infrastructure.process.ProcessSupervisor
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import tools.jackson.databind.ObjectMapper
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong

class OpenSpecDraftIT {
    @TempDir lateinit var root:Path
    @Test fun `create action waits for review then writes accepted draft and rejects another`() {
        val mapper=ObjectMapper();val operations=MemoryOperations();val draftStore=MemoryDrafts()
        val workflow=OpenSpecService(Projects(root),ProcessRunner{_,_->error("CLI is not used")},mapper,"/fake/openspec")
        val service=OpenSpecActionService(workflow,operations,draftStore,ProcessSupervisor(),mapper)
        val started=service.start(ID,CreateOpenSpecActionCommand("create_change","demo",proposal="# Demo"),"corr")
        val reviewed=await(service,started.id);val target=root.resolve("openspec/changes/demo/proposal.md")
        assertThat(reviewed.status).isEqualTo("awaiting_review");assertThat(target).doesNotExist()
        val accepted=service.accept(ID,started.id);assertThat(accepted.mutations).singleElement().extracting("path").isEqualTo("openspec/changes/demo/proposal.md")
        assertThat(service.write(ID,accepted.id).status).isEqualTo("written");assertThat(target).hasContent("# Demo")
        val rejectedStart=service.start(ID,CreateOpenSpecActionCommand("create_change","other",proposal="# Other"),"")
        val rejected=service.reject(ID,await(service,rejectedStart.id).id);assertThat(rejected.status).isEqualTo("rejected");assertThat(root.resolve("openspec/changes/other/proposal.md")).doesNotExist()
    }
    private fun await(service:OpenSpecActionService,id:String):CloneOperation{repeat(200){val item=service.get(ID,id);if(item.terminal())return item;Thread.sleep(5)};error("timeout")}
    private class Projects(path:Path):ProjectRepository{private val p=Project(ID,"Test",path.toString(),createdAt=Instant.EPOCH,updatedAt=Instant.EPOCH);override fun list()=listOf(p);override fun get(id:String)=p.takeIf{id==ID};override fun create(name:String,storePath:String)=error("unused");override fun update(id:String,command:UpdateProjectCommand)=error("unused");override fun delete(id:String)=false}
    private class MemoryOperations:RepositoryStore{private val values=linkedMapOf<String,CloneOperation>();private val events=mutableListOf<OperationEvent>();private val seq=AtomicLong()
        override fun listRepositories(projectId:String)=emptyList<RepositoryLink>();override fun createRepository(item:RepositoryLink)=error("unused");override fun updateRepository(item:RepositoryLink)=null
        @Synchronized override fun createOperation(item:CloneOperation)=item.copy(id=UUID.randomUUID().toString(),createdAt=Instant.now(),updatedAt=Instant.now()).also{values[it.id]=it}
        @Synchronized override fun getOperation(id:String)=values[id];@Synchronized override fun updateOperation(item:CloneOperation)=item.copy(updatedAt=Instant.now()).also{values[it.id]=it}
        override fun hasActiveOperation(projectId:String,kind:String)=values.values.any{it.projectId==projectId&&it.kind==kind&&!it.terminal()}
        override fun addEvent(operationId:String,type:String,payload:String)=OperationEvent(seq.incrementAndGet(),operationId,type,payload,Instant.now()).also(events::add)
        override fun listEvents(operationId:String,after:Long)=events.filter{it.operationId==operationId&&it.sequence>after}}
    private class MemoryDrafts:OpenSpecOperationStore{private val sets=linkedMapOf<String,DraftSet>();override fun list(projectId:String,change:String)=emptyList<CloneOperation>()
        override fun saveDraft(set:DraftSet):DraftSet{val id=UUID.randomUUID().toString();return set.copy(id=id,createdAt=Instant.now(),updatedAt=Instant.now(),mutations=set.mutations.map{it.copy(id=UUID.randomUUID().toString(),setId=id)}).also{sets[id]=it}}
        override fun getDraft(id:String)=sets[id];override fun getDraftByOperation(operationId:String)=sets.values.firstOrNull{it.operationId==operationId};override fun updateDraftStatus(id:String,status:String)=sets[id]?.copy(status=status,updatedAt=Instant.now())?.also{sets[id]=it}}
    private companion object{const val ID="project-1"}
}
