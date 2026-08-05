package com.sorface.openspecstudio.infrastructure.ai

import com.sorface.openspecstudio.application.ProcessCancellation
import com.sorface.openspecstudio.application.ProcessCommand
import com.sorface.openspecstudio.application.ProcessRunner
import com.sorface.openspecstudio.application.PublicationMessageGenerator
import com.sorface.openspecstudio.config.LocalServerProperties
import com.sorface.openspecstudio.domain.ai.AiException
import com.sorface.openspecstudio.domain.taskcontext.GeneratedCommitMessage
import com.sorface.openspecstudio.domain.taskcontext.PublicationMessageRequest
import org.springframework.stereotype.Component
import org.springframework.beans.factory.annotation.Value
import tools.jackson.databind.ObjectMapper
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration

/** Генерирует commit message read-only Agent CLI без доступа к Store. */
@Component
internal class AiPublicationMessageGenerator(
    private val runner: ProcessRunner,
    private val mapper: ObjectMapper,
    properties: LocalServerProperties,
    @Value("\${ai.cli.path:}") private val configuredCli: String = "",
) : PublicationMessageGenerator {
    private val root = properties.dataDir.resolve("commit-messages")
    override fun generate(request: PublicationMessageRequest): GeneratedCommitMessage {
        if (request.task.isBlank() || request.diff.isBlank()) throw AiException("INVALID_AI_CONTEXT", "Diff пуст")
        val executable = executable(request.provider)
        Files.createDirectories(root)
        val working = Files.createTempDirectory(root, "message-")
        try {
            val arguments = when (request.provider.lowercase()) {
                "codex" -> mutableListOf("exec", "--json", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", "--cd", working.toString(), "--ignore-rules", "--config", "model_reasoning_effort=\"low\"")
                "gigacode" -> mutableListOf("--non-interactive", "--json", "--cwd", working.toString())
                else -> throw AiException("AI_PROVIDER_UNSUPPORTED", "Provider не поддерживается")
            }
            if (request.model.isNotBlank()) arguments += listOf("--model", request.model)
            arguments += "-"
            val paths = mapper.writeValueAsString(request.paths)
            val prompt = "Сформируй на русском языке сообщение commit по точному diff OpenSpec-артефактов. " +
                "Не используй инструменты, shell или файлы. Ответь только JSON-объектом {\"subject\":\"...\",\"body\":\"...\"}. " +
                "Subject: ${request.task}: <короткое сообщение>. Body — непустой маркированный список, каждая строка начинается с '- '.\n\n" +
                "ЗАДАЧА: ${request.task}\nPATHS: $paths\nDIFF:\n${request.diff}"
            val result = runner.run(ProcessCommand(executable, arguments, directory = working, stdin = prompt,
                timeout = Duration.ofSeconds(45), maxOutputBytes = 256L shl 10), ProcessCancellation.NONE)
            if (!result.successful) throw AiException("AI_PROVIDER_FAILED", "Agent CLI завершился с ошибкой")
            var response = finalResponse(result.stdout).trim().removePrefix("```json").removePrefix("```").removeSuffix("```").trim()
            return mapper.readValue(response, GeneratedCommitMessage::class.java).also { if (it.subject.isBlank()) throw AiException("AI_PROVIDER_FAILED", "Некорректный ответ") }
        } finally { working.toFile().deleteRecursively() }
    }
    private fun executable(provider: String): Path {
        val name = provider.lowercase()
        if (name !in setOf("codex", "gigacode")) throw AiException("AI_PROVIDER_UNSUPPORTED", "Provider не поддерживается")
        configuredCli.trim().takeIf(String::isNotBlank)?.let {
            val path = Path.of(it).toAbsolutePath()
            if (Files.isRegularFile(path) && Files.isExecutable(path)) return path
            throw AiException("AI_PROVIDER_UNAVAILABLE", "Agent CLI недоступен")
        }
        return System.getenv("PATH").orEmpty().split(System.getProperty("path.separator")).asSequence().map { Path.of(it, name) }
            .firstOrNull { Files.isRegularFile(it) && Files.isExecutable(it) } ?: throw AiException("AI_PROVIDER_UNAVAILABLE", "Agent CLI недоступен")
    }
    private fun finalResponse(output: String) = output.lineSequence().mapNotNull { line -> runCatching {
        val node = mapper.readTree(line); node.path("message").asText().ifBlank { node.path("item").path("text").asText() }.takeIf(String::isNotBlank)
    }.getOrNull() }.lastOrNull() ?: output
}
