package com.sorface.openspecstudio.api

import com.sorface.openspecstudio.application.CapabilitiesProvider
import com.sorface.openspecstudio.application.CsrfTokenProvider
import org.springframework.http.CacheControl
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/** Системные endpoints локального приложения. */
@RestController
@RequestMapping("/api/v1/system")
internal class SystemController(
    private val csrfTokenProvider: CsrfTokenProvider,
    private val capabilitiesProvider: CapabilitiesProvider,
) {
    @GetMapping("/health")
    fun health(): HealthResponse = HealthResponse()

    @GetMapping("/session")
    fun session(): SessionResponse = SessionResponse(csrfTokenProvider.token())

    @GetMapping("/capabilities")
    fun capabilities(): ResponseEntity<SystemCapabilities> = ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(capabilitiesProvider.detect())
}
