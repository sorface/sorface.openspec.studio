package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.domain.openspec.ChangeCreationDraft
import com.sorface.openspecstudio.domain.openspec.OpenSpecException
import com.sorface.openspecstudio.domain.project.Project
import com.sorface.openspecstudio.domain.project.UpdateProjectCommand
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.Test
import tools.jackson.databind.ObjectMapper
import java.time.Instant

class ChangeCreationDraftServiceTest {
    @Test fun `normalizes project and persists valid draft`() { val repo=MemoryDrafts();val service=ChangeCreationDraftService(Projects,repo,ObjectMapper())
        val saved=service.save(ID,ChangeCreationDraft(intent="Новая возможность"));assertThat(saved.projectId).isEqualTo(ID);assertThat(service.get(ID)?.intent).isEqualTo("Новая возможность")
        service.delete(ID);assertThat(service.get(ID)).isNull() }
    @Test fun `rejects invalid creation lifecycle`() { val service=ChangeCreationDraftService(Projects,MemoryDrafts(),ObjectMapper())
        assertThatThrownBy{service.save(ID,ChangeCreationDraft(stage="creating",proposalAccepted=false))}.isInstanceOf(OpenSpecException::class.java).extracting("code").isEqualTo("INVALID_CREATION_DRAFT") }
    private class MemoryDrafts:ChangeCreationDraftRepository{private var value:ChangeCreationDraft?=null;override fun get(projectId:String)=value;override fun save(draft:ChangeCreationDraft)=draft.also{value=it};override fun delete(projectId:String)=value.let{value=null;it!=null}}
    private object Projects:ProjectRepository{private val project=Project(ID,"Test","/tmp",createdAt=Instant.EPOCH,updatedAt=Instant.EPOCH);override fun list()=listOf(project);override fun get(id:String)=project.takeIf{id==ID};override fun create(name:String,storePath:String)=error("unused");override fun update(id:String,command:UpdateProjectCommand)=error("unused");override fun delete(id:String)=false}
    private companion object{const val ID="project-1"}
}
