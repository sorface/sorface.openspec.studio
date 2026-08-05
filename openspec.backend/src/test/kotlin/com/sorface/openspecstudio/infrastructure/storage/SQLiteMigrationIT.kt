package com.sorface.openspecstudio.infrastructure.storage

import com.sorface.openspecstudio.application.ProcessAudit
import com.sorface.openspecstudio.infrastructure.process.JdbcProcessAuditSink
import liquibase.integration.spring.SpringLiquibase
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.springframework.jdbc.core.simple.JdbcClient
import org.sqlite.SQLiteDataSource
import java.nio.file.Path
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import javax.sql.DataSource

@DisplayName("SQLite schema Kotlin backend")
class SQLiteMigrationIT {
    @TempDir
    lateinit var tempDir: Path

    @Test
    @DisplayName("создаёт все совместимые таблицы, индексы и версии schema")
    fun createsCompatibleSchema() {
        val dataSource = migrate(tempDir.resolve("new.db"))
        val jdbc = JdbcClient.create(dataSource)

        val tables = names(jdbc, "table")
        val indexes = names(jdbc, "index")
        val versions = jdbc.sql("SELECT version FROM schema_migrations ORDER BY version")
            .query(Int::class.java).list()

        assertThat(tables).containsAll(EXPECTED_TABLES)
        assertThat(indexes).containsAll(EXPECTED_INDEXES)
        assertThat(versions).containsExactly(1, 2, 3)
    }

    @Test
    @DisplayName("обновляет legacy operations table без потери существующей строки")
    fun migratesLegacyOperationsTable() {
        val path = tempDir.resolve("legacy.db")
        val dataSource = sqlite(path)
        dataSource.connection.use { connection ->
            connection.createStatement().use { statement ->
                statement.executeUpdate(LEGACY_OPERATIONS_SQL)
                statement.executeUpdate(
                    """
                    INSERT INTO operations
                    (id, project_id, kind, status, created_at, updated_at)
                    VALUES ('operation-1', 'project-1', 'openspec', 'running', 'old', 'old')
                    """.trimIndent(),
                )
            }
        }

        applyLiquibase(dataSource)
        val jdbc = JdbcClient.create(dataSource)
        val columns = jdbc.sql("PRAGMA table_info(operations)").query { row, _ -> row.getString("name") }.list()

        assertThat(columns).contains(
            "openspec_action", "openspec_change", "openspec_schema", "openspec_artifact", "openspec_fingerprint",
        )
        assertThat(jdbc.sql("SELECT COUNT(*) FROM operations WHERE id='operation-1'").query(Int::class.java).single())
            .isEqualTo(1)
    }

    @Test
    @DisplayName("помечает только незавершённые операции после restart")
    fun recoversInterruptedOperations() {
        val dataSource = migrate(tempDir.resolve("recovery.db"))
        val jdbc = JdbcClient.create(dataSource)
        jdbc.sql(
            """
            INSERT INTO projects(id, name, store_path, created_at, updated_at)
            VALUES ('project-1', 'Platform', '/store', 'old', 'old')
            """.trimIndent(),
        ).update()
        for ((id, status) in listOf("queued" to "queued", "running" to "running", "done" to "succeeded")) {
            jdbc.sql(
                """
                INSERT INTO operations(id, project_id, kind, status, created_at, updated_at)
                VALUES (:id, 'project-1', 'ai', :status, 'old', 'old')
                """.trimIndent(),
            ).param("id", id).param("status", status).update()
        }
        val recovery = JdbcOperationRecovery(
            jdbc,
            Clock.fixed(Instant.parse("2026-08-05T12:00:00Z"), ZoneOffset.UTC),
        )

        assertThat(recovery.recoverInterrupted()).isEqualTo(2)
        assertThat(jdbc.sql("SELECT status FROM operations WHERE id='running'").query(String::class.java).single())
            .isEqualTo("failed")
        assertThat(jdbc.sql("SELECT error_code FROM operations WHERE id='queued'").query(String::class.java).single())
            .isEqualTo("APPLICATION_RESTARTED")
        assertThat(jdbc.sql("SELECT status FROM operations WHERE id='done'").query(String::class.java).single())
            .isEqualTo("succeeded")
    }

    @Test
    @DisplayName("сохраняет process audit без secret payload")
    fun savesProcessAudit() {
        val jdbc = JdbcClient.create(migrate(tempDir.resolve("audit.db")))
        jdbc.sql(
            """
            INSERT INTO projects(id, name, store_path, created_at, updated_at)
            VALUES ('project-audit', 'Audit', '/store', 'old', 'old')
            """.trimIndent(),
        ).update()
        jdbc.sql(
            """
            INSERT INTO operations(id, project_id, kind, status, created_at, updated_at)
            VALUES ('operation-audit', 'project-audit', 'ai', 'running', 'old', 'old')
            """.trimIndent(),
        ).update()
        val sink = JdbcProcessAuditSink(jdbc, Clock.fixed(Instant.parse("2026-08-05T12:00:00Z"), ZoneOffset.UTC))

        sink.save(ProcessAudit("operation-audit", "codex", "exec [REDACTED]", 0, "", 12, 3, 42))

        val audit = jdbc.sql("SELECT arguments, stdout_bytes, duration_ms FROM operation_audit WHERE operation_id='operation-audit'")
            .query { row, _ -> Triple(row.getString(1), row.getLong(2), row.getLong(3)) }.single()
        assertThat(audit).isEqualTo(Triple("exec [REDACTED]", 12L, 42L))
    }

    private fun migrate(path: Path): DataSource = sqlite(path).also(::applyLiquibase)

    private fun sqlite(path: Path): SQLiteDataSource = SQLiteDataSource().apply {
        url = "jdbc:sqlite:${path.toAbsolutePath()}"
    }

    private fun applyLiquibase(dataSource: DataSource) {
        SpringLiquibase().apply {
            this.dataSource = dataSource
            changeLog = "classpath:db/changelog/db.changelog-master.yaml"
            afterPropertiesSet()
        }
    }

    private fun names(jdbc: JdbcClient, type: String): List<String> = jdbc.sql(
        "SELECT name FROM sqlite_master WHERE type=:type AND name NOT LIKE 'sqlite_%'",
    ).param("type", type).query(String::class.java).list().filterNotNull()

    private companion object {
        val EXPECTED_TABLES = listOf(
            "schema_migrations", "projects", "task_workspaces", "repositories", "operations",
            "operation_events", "ai_context_entries", "operation_audit", "draft_sets", "draft_mutations",
            "openspec_change_drafts",
        )
        val EXPECTED_INDEXES = listOf(
            "projects_updated_at_idx", "task_workspaces_project_idx", "repositories_project_idx",
            "operations_project_idx", "operations_active_idx", "operation_events_operation_idx",
            "draft_mutations_set_idx",
        )
        val LEGACY_OPERATIONS_SQL =
            """
            CREATE TABLE operations (
              id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL,
              kind TEXT NOT NULL,
              status TEXT NOT NULL,
              provider TEXT NOT NULL DEFAULT '',
              model TEXT NOT NULL DEFAULT '',
              prompt TEXT NOT NULL DEFAULT '',
              input_json TEXT NOT NULL DEFAULT '{}',
              result_json TEXT NOT NULL DEFAULT '',
              error_code TEXT NOT NULL DEFAULT '',
              error_message TEXT NOT NULL DEFAULT '',
              correlation_id TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            )
            """.trimIndent()
    }
}
