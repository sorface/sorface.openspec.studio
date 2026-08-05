package com.sorface.openspecstudio.infrastructure.repository

import com.sorface.openspecstudio.application.RepositoryStore
import com.sorface.openspecstudio.domain.repository.CloneOperation
import com.sorface.openspecstudio.domain.repository.OperationEvent
import com.sorface.openspecstudio.domain.repository.RepositoryLink
import com.sorface.openspecstudio.domain.ai.ContextEntry
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import java.sql.ResultSet
import java.time.Clock
import java.time.Instant
import java.util.UUID

/** SQLite persistence adapter repository links и clone lifecycle. */
@Repository
internal class JdbcRepositoryStore(private val jdbc: JdbcClient, private val clock: Clock) : RepositoryStore {
    override fun listRepositories(projectId: String): List<RepositoryLink> = jdbc.sql(
        """
        SELECT id, project_id, name, path, remote_url, fingerprint, branch, commit_sha, dirty, created_at, updated_at
        FROM repositories WHERE project_id=:projectId ORDER BY updated_at DESC
        """.trimIndent(),
    ).param("projectId", projectId).query(::repository).list()

    override fun createRepository(item: RepositoryLink): RepositoryLink {
        val now = Instant.now(clock)
        val created = item.copy(id = item.id.ifBlank { UUID.randomUUID().toString().replace("-", "") }, createdAt = now, updatedAt = now)
        jdbc.sql(
            """
            INSERT INTO repositories(id, project_id, name, path, remote_url, fingerprint, branch, commit_sha, dirty, created_at, updated_at)
            VALUES (:id, :projectId, :name, :path, :remoteUrl, :fingerprint, :branch, :commitSha, :dirty, :createdAt, :updatedAt)
            """.trimIndent(),
        ).params(repositoryParams(created)).update()
        return created
    }

    override fun updateRepository(item: RepositoryLink): RepositoryLink? {
        val updated = item.copy(updatedAt = Instant.now(clock))
        val count = jdbc.sql(
            """
            UPDATE repositories SET fingerprint=:fingerprint, branch=:branch, commit_sha=:commitSha,
                dirty=:dirty, updated_at=:updatedAt WHERE id=:id AND project_id=:projectId
            """.trimIndent(),
        ).params(repositoryParams(updated)).update()
        return updated.takeIf { count == 1 }
    }

    override fun createOperation(item: CloneOperation): CloneOperation {
        val now = Instant.now(clock)
        val created = item.copy(id = item.id.ifBlank { UUID.randomUUID().toString().replace("-", "") }, createdAt = now, updatedAt = now)
        jdbc.sql(
            """
            INSERT INTO operations(id,project_id,kind,status,provider,model,prompt,input_json,result_json,error_code,error_message,correlation_id,
              openspec_action,openspec_change,openspec_schema,openspec_artifact,openspec_fingerprint,created_at,updated_at)
            VALUES (:id,:projectId,:kind,:status,:provider,:model,:prompt,:inputJson,:result,:errorCode,:errorMessage,:correlationId,
              :openspecAction,:openspecChange,:openspecSchema,:openspecArtifact,:openspecFingerprint,:createdAt,:updatedAt)
            """.trimIndent(),
        ).params(operationParams(created)).update()
        return created
    }

    override fun getOperation(id: String): CloneOperation? = jdbc.sql(
        """
        SELECT *
        FROM operations WHERE id=:id
        """.trimIndent(),
    ).param("id", id).query(::operation).optional().orElse(null)

    override fun listOperations(projectId: String, kind: String): List<CloneOperation> = jdbc.sql(
        "SELECT * FROM operations WHERE project_id=:projectId AND kind=:kind ORDER BY created_at DESC LIMIT 100",
    ).params(mapOf("projectId" to projectId, "kind" to kind)).query(::operation).list()

    override fun updateOperation(item: CloneOperation): CloneOperation? {
        val updated = item.copy(updatedAt = Instant.now(clock))
        val count = jdbc.sql(
            """
            UPDATE operations SET status=:status,provider=:provider,model=:model,prompt=:prompt,input_json=:inputJson,result_json=:result,
                error_code=:errorCode,error_message=:errorMessage,correlation_id=:correlationId,openspec_action=:openspecAction,
                openspec_change=:openspecChange,openspec_schema=:openspecSchema,openspec_artifact=:openspecArtifact,
                openspec_fingerprint=:openspecFingerprint,updated_at=:updatedAt WHERE id=:id
            """.trimIndent(),
        ).params(operationParams(updated)).update()
        return updated.takeIf { count == 1 }
    }

    override fun hasActiveOperation(projectId: String, kind: String): Boolean = jdbc.sql(
        """
        SELECT COUNT(*) FROM operations
        WHERE project_id=:projectId AND kind=:kind AND status IN ('queued','running','validating')
        """.trimIndent(),
    ).params(mapOf("projectId" to projectId, "kind" to kind)).query(Int::class.java).single() > 0

    override fun addEvent(operationId: String, type: String, payload: String): OperationEvent {
        val createdAt = Instant.now(clock)
        val key = jdbc.sql(
            """
            INSERT INTO operation_events(operation_id, type, payload, created_at)
            VALUES (:operationId, :type, :payload, :createdAt)
            RETURNING sequence
            """.trimIndent(),
        ).params(mapOf("operationId" to operationId, "type" to type, "payload" to payload, "createdAt" to createdAt.toString()))
            .query(Long::class.java)
            .single()
        return OperationEvent(key, operationId, type, payload, createdAt)
    }

    override fun listEvents(operationId: String, after: Long): List<OperationEvent> = jdbc.sql(
        """
        SELECT sequence, operation_id, type, payload, created_at FROM operation_events
        WHERE operation_id=:operationId AND sequence>:after ORDER BY sequence
        """.trimIndent(),
    ).params(mapOf("operationId" to operationId, "after" to after)).query { row, _ ->
        OperationEvent(row.getLong("sequence"), row.getString("operation_id"), row.getString("type"), row.getString("payload"), Instant.parse(row.getString("created_at")))
    }.list()

    override fun saveAiContext(operationId: String, entries: List<ContextEntry>) {
        jdbc.sql("DELETE FROM ai_context_entries WHERE operation_id=:operationId").param("operationId", operationId).update()
        entries.forEach { entry -> jdbc.sql(
            """INSERT INTO ai_context_entries(operation_id,source,path,size,checksum,reason,included)
               VALUES (:operationId,:source,:path,:size,:checksum,:reason,:included)""",
        ).params(mapOf("operationId" to operationId, "source" to entry.source, "path" to entry.path,
            "size" to entry.size, "checksum" to entry.checksum, "reason" to entry.reason, "included" to entry.included)).update() }
    }

    private fun repository(row: ResultSet, ignored: Int): RepositoryLink = RepositoryLink(
        id = row.getString("id"), projectId = row.getString("project_id"), name = row.getString("name"),
        path = row.getString("path"), remoteUrl = row.getString("remote_url"), fingerprint = row.getString("fingerprint"),
        branch = row.getString("branch"), commitSha = row.getString("commit_sha"), dirty = row.getBoolean("dirty"),
        createdAt = Instant.parse(row.getString("created_at")), updatedAt = Instant.parse(row.getString("updated_at")),
    )

    private fun operation(row: ResultSet, ignored: Int): CloneOperation = CloneOperation(
        id = row.getString("id"), projectId = row.getString("project_id"), kind = row.getString("kind"),
        status = row.getString("status"), errorCode = row.getString("error_code"), errorMessage = row.getString("error_message"),
        correlationId = row.getString("correlation_id"),provider=row.getString("provider"),model=row.getString("model"),prompt=row.getString("prompt"),
        result=row.getString("result_json"),openspecAction=row.getString("openspec_action"),openspecChange=row.getString("openspec_change"),
        openspecSchema=row.getString("openspec_schema"),openspecArtifact=row.getString("openspec_artifact"),openspecFingerprint=row.getString("openspec_fingerprint"),
        inputJson = row.getString("input_json"),
        createdAt = Instant.parse(row.getString("created_at")), updatedAt = Instant.parse(row.getString("updated_at")),
    )

    private fun repositoryParams(item: RepositoryLink) = mapOf(
        "id" to item.id, "projectId" to item.projectId, "name" to item.name, "path" to item.path,
        "remoteUrl" to item.remoteUrl, "fingerprint" to item.fingerprint, "branch" to item.branch,
        "commitSha" to item.commitSha, "dirty" to item.dirty, "createdAt" to item.createdAt.toString(), "updatedAt" to item.updatedAt.toString(),
    )

    private fun operationParams(item: CloneOperation) = mapOf(
        "id" to item.id, "projectId" to item.projectId, "kind" to item.kind, "status" to item.status, "inputJson" to item.inputJson,
        "errorCode" to item.errorCode, "errorMessage" to item.errorMessage, "correlationId" to item.correlationId,
        "provider" to item.provider,"model" to item.model,"prompt" to item.prompt,"result" to item.result,
        "openspecAction" to item.openspecAction,"openspecChange" to item.openspecChange,"openspecSchema" to item.openspecSchema,
        "openspecArtifact" to item.openspecArtifact,"openspecFingerprint" to item.openspecFingerprint,
        "createdAt" to item.createdAt.toString(), "updatedAt" to item.updatedAt.toString(),
    )
}
