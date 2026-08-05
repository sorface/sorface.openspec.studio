package com.sorface.openspecstudio.infrastructure.taskcontext

import com.sorface.openspecstudio.application.TaskWorkspaceRepository
import com.sorface.openspecstudio.domain.taskcontext.TaskWorkspace
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import java.sql.ResultSet
import java.time.Clock
import java.time.Instant
import java.util.UUID

@Repository
internal class JdbcTaskWorkspaceRepository(private val jdbc: JdbcClient, private val clock: Clock) : TaskWorkspaceRepository {
    override fun list(projectId: String) = jdbc.sql("""SELECT w.*,w.id=p.active_worktree_id AS active FROM task_workspaces w
        JOIN projects p ON p.id=w.project_id WHERE w.project_id=:projectId ORDER BY active DESC,w.updated_at DESC""")
        .param("projectId", projectId).query(::map).list()
    override fun findByBranch(projectId: String, branch: String) = jdbc.sql("""SELECT w.*,w.id=p.active_worktree_id AS active FROM task_workspaces w
        JOIN projects p ON p.id=w.project_id WHERE w.project_id=:projectId AND w.branch=:branch""")
        .params(mapOf("projectId" to projectId, "branch" to branch)).query(::map).optional().orElse(null)
    override fun create(workspace: TaskWorkspace): TaskWorkspace {
        val now=Instant.now(clock); val item=workspace.copy(id=workspace.id.ifBlank { UUID.randomUUID().toString().replace("-","") },createdAt=now,updatedAt=now)
        jdbc.sql("""INSERT INTO task_workspaces(id,project_id,branch,path,managed,created_at,updated_at)
            VALUES(:id,:projectId,:branch,:path,:managed,:createdAt,:updatedAt)""").params(mapOf("id" to item.id,"projectId" to item.projectId,
            "branch" to item.branch,"path" to item.path,"managed" to if(item.managed) 1 else 0,"createdAt" to now.toString(),"updatedAt" to now.toString())).update()
        return item
    }
    override fun activate(projectId: String, workspaceId: String): Boolean {
        val exists=jdbc.sql("SELECT COUNT(*) FROM task_workspaces WHERE project_id=:projectId AND id=:id").params(mapOf("projectId" to projectId,"id" to workspaceId)).query(Int::class.java).single()==1
        if(!exists)return false
        val now=Instant.now(clock).toString()
        jdbc.sql("UPDATE task_workspaces SET updated_at=:now WHERE id=:id").params(mapOf("now" to now,"id" to workspaceId)).update()
        return jdbc.sql("UPDATE projects SET active_worktree_id=:id,updated_at=:now WHERE id=:projectId").params(mapOf("id" to workspaceId,"now" to now,"projectId" to projectId)).update()==1
    }
    private fun map(row:ResultSet,ignored:Int)=TaskWorkspace(row.getString("id"),row.getString("project_id"),row.getString("branch"),row.getString("path"),
        row.getInt("managed")!=0,row.getInt("active")!=0,createdAt=Instant.parse(row.getString("created_at")),updatedAt=Instant.parse(row.getString("updated_at")))
}
