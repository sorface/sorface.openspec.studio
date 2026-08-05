package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.domain.openspec.OpenSpecException
import com.sorface.openspecstudio.domain.project.Project
import com.sorface.openspecstudio.domain.project.UpdateProjectCommand
import com.sorface.openspecstudio.infrastructure.process.SafeProcessRunner
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.springframework.beans.factory.support.StaticListableBeanFactory
import tools.jackson.databind.ObjectMapper
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.PosixFilePermission
import java.time.Instant

@DisplayName("OpenSpec CLI adapter")
class OpenSpecCliIT {
    @TempDir lateinit var root:Path
    @Test
    @DisplayName("читает changes, details, instructions и strict validation")
    fun readsChangesDetailsInstructionsAndStrictValidation() {
        val change=root.resolve("openspec/changes/demo");Files.createDirectories(change);Files.writeString(change.resolve("proposal.md"),"# Demo\n")
        val service=service(SCRIPT)
        val overview=service.overview(ID);val details=service.details(ID,"demo");val validation=service.validate(ID,"demo")
        assertThat(overview.changes).singleElement().extracting("name").isEqualTo("demo")
        assertThat(details.actions.map{it.kind}).contains("prepare_artifact","archive")
        assertThat(details.fingerprint).hasSize(64);assertThat(validation.valid).isTrue()
    }

    @Test
    @DisplayName("сохраняет OPENSPEC_READ_ONLY_VIOLATION для list")
    fun preservesReadOnlyViolationForList() {
        Files.createDirectories(root.resolve("openspec"))
        Files.writeString(root.resolve("openspec/config.yaml"), "schema: spec-driven\n")

        assertThatThrownBy { service(MUTATING_LIST_SCRIPT).overview(ID) }
            .isInstanceOf(OpenSpecException::class.java)
            .extracting("code").isEqualTo("OPENSPEC_READ_ONLY_VIOLATION")
    }

    @Test
    @DisplayName("сохраняет OPENSPEC_READ_ONLY_VIOLATION для instructions")
    fun preservesReadOnlyViolationForInstructions() {
        val change = root.resolve("openspec/changes/demo")
        Files.createDirectories(change)
        Files.writeString(change.resolve("proposal.md"), "# Demo\n")
        Files.writeString(root.resolve("openspec/config.yaml"), "schema: spec-driven\n")

        assertThatThrownBy { service(MUTATING_INSTRUCTIONS_SCRIPT).details(ID, "demo") }
            .isInstanceOf(OpenSpecException::class.java)
            .extracting("code").isEqualTo("OPENSPEC_READ_ONLY_VIOLATION")
    }

    private fun service(script: String): OpenSpecService {
        val cli=root.resolve("fake-openspec-${System.nanoTime()}")
        Files.writeString(cli,script)
        Files.setPosixFilePermissions(cli,setOf(PosixFilePermission.OWNER_READ,PosixFilePermission.OWNER_WRITE,PosixFilePermission.OWNER_EXECUTE))
        val runner=SafeProcessRunner(StaticListableBeanFactory().getBeanProvider(ProcessAuditSink::class.java))
        return OpenSpecService(Projects(root),runner,ObjectMapper(),cli.toString())
    }
    private class Projects(path:Path):ProjectRepository{private val project=Project(ID,"Test",path.toString(),createdAt=Instant.EPOCH,updatedAt=Instant.EPOCH);override fun list()=listOf(project);override fun get(id:String)=project.takeIf{id==ID};override fun create(name:String,storePath:String)=error("unused");override fun update(id:String,command:UpdateProjectCommand)=error("unused");override fun delete(id:String)=false}
    private companion object { const val ID="project-1";val SCRIPT="""#!/bin/sh
case "${'$'}1" in
  --version) echo '1.2.0' ;;
  list) echo '{"changes":[{"name":"demo","completedTasks":1,"totalTasks":2,"lastModified":"2026-08-05T00:00:00Z","status":"active"}]}' ;;
  status) echo '{"changeName":"demo","schemaName":"spec-driven","isComplete":false,"applyRequires":["tasks"],"artifacts":[{"id":"proposal","outputPath":"proposal.md","status":"ready","requires":[]}]}' ;;
  instructions) echo '{"artifactId":"proposal","resolvedOutputPath":"openspec/changes/demo/proposal.md","dependencies":[]}' ;;
  validate) echo '{"items":[{"valid":true,"issues":[]}],"summary":{"totals":{"failed":0}}}' ;;
  *) echo '{}' ;;
esac
"""
        val MUTATING_LIST_SCRIPT="""#!/bin/sh
case "${'$'}1" in
  --version) echo '1.2.0' ;;
  list) printf '\n# mutation\n' >> openspec/config.yaml; echo '{"changes":[]}' ;;
  *) echo '{}' ;;
esac
"""
        val MUTATING_INSTRUCTIONS_SCRIPT="""#!/bin/sh
case "${'$'}1" in
  --version) echo '1.2.0' ;;
  list) echo '{"changes":[{"name":"demo","completedTasks":0,"totalTasks":0,"lastModified":"2026-08-05T00:00:00Z","status":"active"}]}' ;;
  status) echo '{"changeName":"demo","schemaName":"spec-driven","isComplete":false,"artifacts":[{"id":"proposal","outputPath":"proposal.md","status":"ready","requires":[],"missingDeps":[]}]}' ;;
  instructions) printf '\n# mutation\n' >> openspec/config.yaml; echo '{"artifactId":"proposal","resolvedOutputPath":"openspec/changes/demo/proposal.md","dependencies":[]}' ;;
  *) echo '{}' ;;
esac
"""
    }
}
