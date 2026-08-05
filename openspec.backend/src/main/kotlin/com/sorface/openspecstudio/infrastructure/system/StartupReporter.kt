package com.sorface.openspecstudio.infrastructure.system

import com.sorface.openspecstudio.config.LocalServerProperties
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.boot.web.server.context.WebServerApplicationContext
import org.springframework.context.ApplicationContext
import org.springframework.context.event.EventListener
import org.springframework.core.env.Environment
import org.springframework.stereotype.Component
import java.awt.Desktop
import java.net.URI

/** Открывает системный browser без изменения состояния приложения. */
interface BrowserOpener {
    /** Открывает локальный URL, если платформа предоставляет browser integration. */
    fun open(uri: URI)
}

@Component
internal class DesktopBrowserOpener : BrowserOpener {
    override fun open(uri: URI) {
        if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) {
            Desktop.getDesktop().browse(uri)
        }
    }
}

@Component
internal class StartupReporter(
    private val context: ApplicationContext,
    private val environment: Environment,
    private val properties: LocalServerProperties,
    private val browserOpener: BrowserOpener,
) {
    @EventListener(ApplicationReadyEvent::class)
    fun report() {
        val webContext = context as? WebServerApplicationContext ?: return
        val webServer = webContext.webServer ?: return
        val host = environment.getProperty("server.address", "127.0.0.1")
        val uri = URI("http://$host:${webServer.port}")
        println("OpenSpec Studio: $uri")
        if (!properties.noBrowser) browserOpener.open(uri)
    }
}
