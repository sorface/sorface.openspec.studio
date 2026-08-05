package com.sorface.openspecstudio.infrastructure.project

import com.sorface.openspecstudio.config.LocalServerProperties
import com.sorface.openspecstudio.domain.project.ProjectException
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path

@DisplayName("Локальный Git Store")
class LocalStoreManagerTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    @DisplayName("проверяет canonical root через Git без shell")
    fun validatesStore() {
        val git = fakeGit(successful = true)
        val store = Files.createDirectory(tempDir.resolve("existing-store")).toRealPath()
        val manager = LocalStoreManager(properties(), git)

        assertThat(manager.validate(store.toString())).isEqualTo(store.toString())
        assertThatThrownBy { manager.validate("relative/store") }
            .isInstanceOf(ProjectException::class.java)
            .extracting("code").isEqualTo("INVALID_STORE_PATH")
    }

    @Test
    @DisplayName("клонирует remote в управляемый каталог и повторно проверяет Store")
    fun clonesStore() {
        val manager = LocalStoreManager(properties(), fakeGit(successful = true))

        val cloned = Path.of(manager.clone("git@example.com:team/Platform Store.git"))

        assertThat(cloned.fileName.toString()).isEqualTo("store")
        assertThat(cloned).startsWith(tempDir.resolve("data/projects"))
        assertThat(Files.isDirectory(cloned)).isTrue()
    }

    @Test
    @DisplayName("не раскрывает stderr clone и классифицирует authentication failure")
    fun classifiesCloneFailure() {
        val manager = LocalStoreManager(properties(), fakeGit(successful = false))

        assertThatThrownBy { manager.clone("ssh://git@example.com/team/store.git") }
            .isInstanceOf(ProjectException::class.java)
            .extracting("code").isEqualTo("GIT_AUTH_FAILED")
        assertThatThrownBy { manager.clone("--upload-pack=evil") }
            .isInstanceOf(ProjectException::class.java)
            .extracting("code").isEqualTo("INVALID_GIT_URL")
    }

    private fun properties(): LocalServerProperties = LocalServerProperties(dataDir = tempDir.resolve("data"))

    private fun fakeGit(successful: Boolean): Path {
        val script = tempDir.resolve(if (successful) "git-ok" else "git-fail")
        val content = if (successful) {
            """
            #!/bin/sh
            if [ "${'$'}3" = "clone" ]; then
              mkdir -p "${'$'}7"
              exit 0
            fi
            if [ "${'$'}3" = "rev-parse" ]; then
              printf '%s\n' "${'$'}2"
              exit 0
            fi
            exit 1
            """.trimIndent()
        } else {
            "#!/bin/sh\nprintf 'Permission denied (publickey)'\nexit 1\n"
        }
        Files.writeString(script, content)
        script.toFile().setExecutable(true)
        return script
    }
}
