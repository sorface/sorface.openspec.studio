package com.sorface.openspecstudio.infrastructure.project

import com.sorface.openspecstudio.application.ProjectRepository
import com.sorface.openspecstudio.domain.project.Project
import com.sorface.openspecstudio.domain.project.UpdateProjectCommand
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import java.sql.ResultSet
import java.time.Clock
import java.time.Instant
import java.util.UUID

/** SQLite JDBC repository проектов. */
@Repository
internal class JdbcProjectRepository(
    private val jdbc: JdbcClient,
    private val clock: Clock,
) : ProjectRepository {
    override fun list(): List<Project> = jdbc.sql("$SELECT_PROJECT ORDER BY p.updated_at DESC")
        .query(::mapProject).list()

    override fun get(id: String): Project? = jdbc.sql("$SELECT_PROJECT WHERE p.id=:id")
        .param("id", id).query(::mapProject).optional().orElse(null)

    override fun create(name: String, storePath: String): Project {
        val now = Instant.now(clock)
        val project = Project(
            id = UUID.randomUUID().toString().replace("-", ""),
            name = name,
            storePath = storePath,
            createdAt = now,
            updatedAt = now,
        )
        jdbc.sql(
            """
            INSERT INTO projects(id, name, store_path, created_at, updated_at)
            VALUES (:id, :name, :storePath, :createdAt, :updatedAt)
            """.trimIndent(),
        ).params(
            mapOf(
                "id" to project.id,
                "name" to project.name,
                "storePath" to project.storePath,
                "createdAt" to project.createdAt.toString(),
                "updatedAt" to project.updatedAt.toString(),
            ),
        ).update()
        return project
    }

    override fun update(id: String, command: UpdateProjectCommand): Project? {
        val current = get(id) ?: return null
        val updated = current.copy(
            name = command.name ?: current.name,
            defaultAiProvider = command.defaultAiProvider ?: current.defaultAiProvider,
            defaultModel = command.defaultModel ?: current.defaultModel,
            updatedAt = Instant.now(clock),
        )
        val statement = jdbc.sql(
            """
            UPDATE projects
            SET name=:name, default_ai_provider=:provider, default_model=:model, updated_at=:updatedAt
            WHERE id=:id
            """.trimIndent(),
        ).param("name", updated.name)
            .param("provider", updated.defaultAiProvider)
            .param("model", updated.defaultModel)
            .param("updatedAt", updated.updatedAt.toString())
            .param("id", id)
        return updated.takeIf { statement.update() == 1 }
    }

    override fun delete(id: String): Boolean = jdbc.sql("DELETE FROM projects WHERE id=:id")
        .param("id", id).update() == 1

    private fun mapProject(row: ResultSet, ignored: Int): Project = Project(
        id = row.getString("id"),
        name = row.getString("name"),
        storePath = row.getString("effective_store_path"),
        baseStorePath = row.getString("base_store_path"),
        activeWorktreeId = row.getString("active_worktree_id"),
        activeTask = row.getString("active_task").takeIf(String::isNotEmpty),
        defaultAiProvider = row.getString("default_ai_provider"),
        defaultModel = row.getString("default_model"),
        createdAt = Instant.parse(row.getString("created_at")),
        updatedAt = Instant.parse(row.getString("updated_at")),
    )

    private companion object {
        val SELECT_PROJECT =
            """
            SELECT p.id, p.name, COALESCE(w.path, p.store_path) AS effective_store_path,
                   p.store_path AS base_store_path, p.active_worktree_id,
                   COALESCE(w.branch, '') AS active_task, p.default_ai_provider,
                   p.default_model, p.created_at, p.updated_at
            FROM projects p
            LEFT JOIN task_workspaces w ON w.id=p.active_worktree_id AND w.project_id=p.id
            """.trimIndent()
    }
}
