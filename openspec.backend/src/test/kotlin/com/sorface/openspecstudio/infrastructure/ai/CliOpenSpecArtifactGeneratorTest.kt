package com.sorface.openspecstudio.infrastructure.ai

import com.sorface.openspecstudio.application.OpenSpecArtifactGenerationRequest
import com.sorface.openspecstudio.application.OpenSpecExplorationRequest
import com.sorface.openspecstudio.application.ProcessCancellation
import com.sorface.openspecstudio.application.ProcessCommand
import com.sorface.openspecstudio.application.ProcessResult
import com.sorface.openspecstudio.application.ProcessRunner
import com.sorface.openspecstudio.config.LocalServerProperties
import com.sorface.openspecstudio.domain.openspec.Instructions
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import tools.jackson.databind.ObjectMapper
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration

@DisplayName("Agent CLI для OpenSpec-артефактов")
class CliOpenSpecArtifactGeneratorTest {
    @TempDir lateinit var root: Path

    @Test
    @DisplayName("готовит diff в изолированном workspace и не меняет исходный Store")
    fun generatesReviewDiffWithoutChangingStore() {
        val store = Files.createDirectories(root.resolve("store/openspec/changes/demo/specs/browser"))
            .let { root.resolve("store") }
        val proposal = store.resolve("openspec/changes/demo/proposal.md")
        val specification = store.resolve("openspec/changes/demo/specs/browser/spec.md")
        Files.writeString(proposal, "# Before\n")
        Files.writeString(specification, "# Before spec\n")
        val runner = WritingRunner()
        val generator = CliOpenSpecArtifactGenerator(
            runner, ObjectMapper(), LocalServerProperties(dataDir = root.resolve("data"), noBrowser = true), "/bin/sh",
        )

        val result = generator.generate(
            OpenSpecArtifactGenerationRequest(
                operationId = "operation-1",
                root = store,
                change = "demo",
                artifact = "specs",
                goal = "Актуализируй proposal и delta specs",
                provider = "codex",
                model = "gpt-5.4-mini",
                instructions = Instructions(
                    artifactId = "specs",
                    instruction = "Update specifications",
                    resolvedOutputPath = "openspec/changes/demo/specs/**/*.md",
                ),
            ),
            ProcessCancellation.NONE,
        )

        assertThat(result.files.map { it.path }).containsExactly(
            "openspec/changes/demo/proposal.md",
            "openspec/changes/demo/specs/browser/spec.md",
        )
        assertThat(result.finalResponse).isEqualTo("Готово")
        assertThat(Files.readString(proposal)).isEqualTo("# Before\n")
        assertThat(Files.readString(specification)).isEqualTo("# Before spec\n")
        assertThat(runner.command!!.arguments).contains("--sandbox", "workspace-write", "--model", "gpt-5.4-mini")
        assertThat(runner.command!!.stdin).contains("SYSTEM ACTION BOUNDARY", "Update specifications")
        assertThat(root.resolve("data/openspec-operations/operation-1")).doesNotExist()
    }

    @Test
    @DisplayName("исследует Store без изменений и разбирает готовый proposal")
    fun exploresStoreAndParsesStructuredProposal() {
        val store = Files.createDirectories(root.resolve("store/openspec")).let { root.resolve("store") }
        Files.writeString(store.resolve("openspec/config.yaml"), "schema: spec-driven\n")
        val runner = ExplorationRunner(mutateStore = false)
        val generator = generator(runner)

        val result = generator.explore(
            OpenSpecExplorationRequest("explore-1", store, "Добавить export", "codex", "gpt-5.4-mini"),
            ProcessCancellation.NONE,
        )

        assertThat(result.state).isEqualTo("proposal_ready")
        assertThat(result.proposal).contains("## Why")
        assertThat(result.suggestedNames).containsExactly("add-json-export")
        assertThat(runner.command!!.stdin).contains("Return exactly one JSON object", "USER TASK", "Добавить export")
        assertThat(Files.readString(store.resolve("openspec/config.yaml"))).isEqualTo("schema: spec-driven\n")
    }

    @Test
    @DisplayName("отклоняет изменение Store во время explore")
    fun rejectsStoreMutationDuringExplore() {
        val store = Files.createDirectories(root.resolve("store/openspec")).let { root.resolve("store") }
        Files.writeString(store.resolve("openspec/config.yaml"), "schema: spec-driven\n")

        assertThatThrownBy {
            generator(ExplorationRunner(mutateStore = true)).explore(
                OpenSpecExplorationRequest("explore-2", store, "Добавить export", "codex", ""),
                ProcessCancellation.NONE,
            )
        }.hasFieldOrPropertyWithValue("code", "AI_SCOPE_VIOLATION")
        assertThat(Files.readString(store.resolve("openspec/config.yaml"))).isEqualTo("schema: spec-driven\n")
    }

    private fun generator(runner: ProcessRunner) = CliOpenSpecArtifactGenerator(
        runner, ObjectMapper(), LocalServerProperties(dataDir = root.resolve("data"), noBrowser = true), "/bin/sh",
    )

    private class WritingRunner : ProcessRunner {
        var command: ProcessCommand? = null

        override fun run(command: ProcessCommand, cancellation: ProcessCancellation): ProcessResult {
            this.command = command
            Files.writeString(command.directory.resolve("openspec/changes/demo/proposal.md"), "# After\n")
            Files.writeString(command.directory.resolve("openspec/changes/demo/specs/browser/spec.md"), "# After spec\n")
            return ProcessResult(
                "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"Готово\"}}\n",
                "", 0, Duration.ofMillis(1), arguments = command.arguments,
            )
        }
    }

    private class ExplorationRunner(private val mutateStore: Boolean) : ProcessRunner {
        var command: ProcessCommand? = null

        override fun run(command: ProcessCommand, cancellation: ProcessCancellation): ProcessResult {
            this.command = command
            if (mutateStore) Files.writeString(command.directory.resolve("openspec/config.yaml"), "schema: changed\n")
            val response = """{"state":"proposal_ready","summary":"Готово","questions":[],"assumptions":[],"proposal":"## Why\\nНужно изменение.","suggestedNames":["add-json-export"]}"""
            return ProcessResult(
                "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":${ObjectMapper().writeValueAsString(response)}}}\n",
                "", 0, Duration.ofMillis(1), arguments = command.arguments,
            )
        }
    }
}
