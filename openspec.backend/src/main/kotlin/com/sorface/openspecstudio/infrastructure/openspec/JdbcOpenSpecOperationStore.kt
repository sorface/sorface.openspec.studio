package com.sorface.openspecstudio.infrastructure.openspec

import com.sorface.openspecstudio.application.OpenSpecOperationStore
import com.sorface.openspecstudio.domain.openspec.DraftMutation
import com.sorface.openspecstudio.domain.openspec.DraftSet
import com.sorface.openspecstudio.domain.repository.CloneOperation
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import java.sql.ResultSet
import java.time.Clock
import java.time.Instant
import java.util.UUID

@Repository
internal class JdbcOpenSpecOperationStore(private val jdbc:JdbcClient,private val clock:Clock):OpenSpecOperationStore{
    override fun list(projectId:String,change:String)=jdbc.sql("SELECT * FROM operations WHERE project_id=:project AND kind='openspec' AND openspec_change=:change ORDER BY created_at DESC LIMIT 50")
        .params(mapOf("project" to projectId,"change" to change)).query(::operation).list()
    override fun saveDraft(set:DraftSet):DraftSet{
        val now=Instant.now(clock);val item=set.copy(id=set.id.ifBlank{UUID.randomUUID().toString().replace("-","")},createdAt=now,updatedAt=now)
        jdbc.sql("INSERT INTO draft_sets(id,project_id,operation_id,status,created_at,updated_at) VALUES(:id,:project,:operation,:status,:created,:updated)")
            .params(mapOf("id" to item.id,"project" to item.projectId,"operation" to item.operationId,"status" to item.status,"created" to now.toString(),"updated" to now.toString())).update()
        item.mutations.forEach{m->jdbc.sql("INSERT INTO draft_mutations(id,set_id,type,path,previous_path,before_content,after_content) VALUES(:id,:setId,:type,:path,:previous,:before,:after)")
            .params(mapOf("id" to UUID.randomUUID().toString().replace("-",""),"setId" to item.id,"type" to m.type,"path" to m.path,"previous" to m.previousPath,"before" to m.before,"after" to m.after)).update()}
        return getDraft(item.id)!!
    }
    override fun getDraft(id:String)=draft("d.id=:value",id)
    override fun getDraftByOperation(operationId:String)=draft("d.operation_id=:value",operationId)
    override fun updateDraftStatus(id:String,status:String):DraftSet?{val now=Instant.now(clock).toString();if(jdbc.sql("UPDATE draft_sets SET status=:status,updated_at=:now WHERE id=:id").params(mapOf("status" to status,"now" to now,"id" to id)).update()!=1)return null;return getDraft(id)}
    private fun draft(where:String,value:String):DraftSet?{
        val set=jdbc.sql("SELECT d.* FROM draft_sets d WHERE $where").param("value",value).query{r,_->DraftSet(r.getString("id"),r.getString("project_id"),r.getString("operation_id"),r.getString("status"),emptyList(),Instant.parse(r.getString("created_at")),Instant.parse(r.getString("updated_at")))}.optional().orElse(null)?:return null
        val mutations=jdbc.sql("SELECT * FROM draft_mutations WHERE set_id=:id ORDER BY rowid").param("id",set.id).query{r,_->DraftMutation(r.getString("id"),r.getString("set_id"),r.getString("type"),r.getString("path"),r.getString("previous_path"),r.getString("before_content"),r.getString("after_content"))}.list()
        return set.copy(mutations=mutations)
    }
    private fun operation(r:ResultSet,ignored:Int)=CloneOperation(r.getString("id"),r.getString("project_id"),r.getString("kind"),r.getString("status"),r.getString("error_code"),r.getString("error_message"),r.getString("correlation_id"),
        provider=r.getString("provider"),model=r.getString("model"),prompt=r.getString("prompt"),result=r.getString("result_json"),openspecAction=r.getString("openspec_action"),openspecChange=r.getString("openspec_change"),openspecSchema=r.getString("openspec_schema"),openspecArtifact=r.getString("openspec_artifact"),openspecFingerprint=r.getString("openspec_fingerprint"),inputJson=r.getString("input_json"),createdAt=Instant.parse(r.getString("created_at")),updatedAt=Instant.parse(r.getString("updated_at")))
}
