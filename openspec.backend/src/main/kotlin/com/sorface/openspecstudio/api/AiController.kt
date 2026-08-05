package com.sorface.openspecstudio.api

import com.sorface.openspecstudio.application.AiOperationService
import com.sorface.openspecstudio.config.correlationId
import com.sorface.openspecstudio.domain.ai.ContextManifestCommand
import com.sorface.openspecstudio.domain.ai.CreateAiOperationCommand
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.*
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter

/** Совместимый HTTP/SSE adapter AI operations. */
@RestController
@RequestMapping("/api/v1/projects/{projectId}/ai")
internal class AiController(private val service: AiOperationService) {
    @PostMapping("/context-manifests") fun manifest(@PathVariable projectId: String, @RequestBody input: ContextManifestCommand) = service.manifest(projectId, input)
    @PostMapping("/operations") @ResponseStatus(HttpStatus.ACCEPTED)
    fun start(@PathVariable projectId: String, @RequestBody input: CreateAiOperationCommand, request: HttpServletRequest) = service.start(projectId, input, correlationId(request))
    @GetMapping("/operations/{operationId}") fun get(@PathVariable projectId: String, @PathVariable operationId: String) = service.get(projectId, operationId)
    @DeleteMapping("/operations/{operationId}") fun cancel(@PathVariable projectId: String, @PathVariable operationId: String) = service.cancel(projectId, operationId)
    @GetMapping("/operations/{operationId}/events", produces = [MediaType.TEXT_EVENT_STREAM_VALUE])
    fun events(@PathVariable projectId: String, @PathVariable operationId: String,
        @RequestHeader(name = "Last-Event-ID", required = false) last: String?): SseEmitter {
        service.get(projectId, operationId)
        val emitter = SseEmitter(0L)
        Thread.ofVirtual().name("ai-events-$operationId").start {
            var after = last?.toLongOrNull() ?: 0L
            var heartbeat = System.nanoTime()
            try {
                while (true) {
                    service.events(projectId, operationId, after).forEach { event ->
                        emitter.send(SseEmitter.event().id(event.sequence.toString()).name(event.type).data(event.payload)); after = event.sequence
                    }
                    if (service.get(projectId, operationId).terminal()) break
                    if (System.nanoTime() - heartbeat > 15_000_000_000L) { emitter.send(SseEmitter.event().comment("heartbeat")); heartbeat = System.nanoTime() }
                    Thread.sleep(100)
                }
                emitter.complete()
            } catch (exception: Exception) { emitter.completeWithError(exception) }
        }
        return emitter
    }
}
