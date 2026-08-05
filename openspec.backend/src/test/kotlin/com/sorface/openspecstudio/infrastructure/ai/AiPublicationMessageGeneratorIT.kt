package com.sorface.openspecstudio.infrastructure.ai

import com.sorface.openspecstudio.application.ProcessAuditSink
import com.sorface.openspecstudio.config.LocalServerProperties
import com.sorface.openspecstudio.domain.taskcontext.PublicationMessageRequest
import com.sorface.openspecstudio.infrastructure.process.SafeProcessRunner
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.springframework.beans.factory.support.StaticListableBeanFactory
import tools.jackson.databind.ObjectMapper
import java.nio.file.Files
import java.nio.file.Path

class AiPublicationMessageGeneratorIT {
    @TempDir lateinit var root: Path
    @Test fun `fake cli produces structured russian commit message`() {
        val cli = root.resolve("fake-codex")
        Files.writeString(cli, "#!/bin/sh\nprintf '%s\\n' '{\"message\":\"{\\\"subject\\\":\\\"TASK-7: обновить спецификацию\\\",\\\"body\\\":\\\"- добавлен сценарий\\\"}\"}'\n")
        cli.toFile().setExecutable(true)
        val runner = SafeProcessRunner(StaticListableBeanFactory().getBeanProvider(ProcessAuditSink::class.java))
        val generator = AiPublicationMessageGenerator(runner, ObjectMapper(), LocalServerProperties(dataDir = root.resolve("data")), cli.toString())
        val message = generator.generate(PublicationMessageRequest("TASK-7", listOf("openspec/changes/x/proposal.md"), "+new", "codex", ""))
        assertThat(message.subject).isEqualTo("TASK-7: обновить спецификацию")
        assertThat(message.body).isEqualTo("- добавлен сценарий")
    }
}
