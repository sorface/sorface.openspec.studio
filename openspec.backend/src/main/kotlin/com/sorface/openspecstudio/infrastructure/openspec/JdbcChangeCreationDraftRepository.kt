package com.sorface.openspecstudio.infrastructure.openspec

import com.sorface.openspecstudio.application.ChangeCreationDraftRepository
import com.sorface.openspecstudio.domain.openspec.ChangeCreationDraft
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import tools.jackson.databind.ObjectMapper
import java.time.Clock
import java.time.Instant

@Repository
internal class JdbcChangeCreationDraftRepository(private val jdbc: JdbcClient, private val mapper: ObjectMapper, private val clock: Clock) : ChangeCreationDraftRepository {
    override fun get(projectId: String): ChangeCreationDraft? = jdbc.sql("SELECT payload_json FROM openspec_change_drafts WHERE project_id=:id")
        .param("id", projectId).query(String::class.java).optional().map { mapper.readValue(it, ChangeCreationDraft::class.java) }.orElse(null)
    override fun save(draft: ChangeCreationDraft): ChangeCreationDraft {
        val now=Instant.now(clock); val current=get(draft.projectId); val item=draft.copy(createdAt=current?.createdAt?:now,updatedAt=now)
        jdbc.sql("""INSERT INTO openspec_change_drafts(project_id,payload_json,created_at,updated_at) VALUES(:id,:payload,:created,:updated)
            ON CONFLICT(project_id) DO UPDATE SET payload_json=:payload,updated_at=:updated""").params(mapOf("id" to item.projectId,
            "payload" to mapper.writeValueAsString(item),"created" to item.createdAt.toString(),"updated" to now.toString())).update()
        return item
    }
    override fun delete(projectId: String)=jdbc.sql("DELETE FROM openspec_change_drafts WHERE project_id=:id").param("id",projectId).update()>0
}
