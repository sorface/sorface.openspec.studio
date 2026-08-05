package com.sorface.openspecstudio.api

import com.sorface.openspecstudio.application.RepositoryService
import com.sorface.openspecstudio.config.correlationId
import com.sorface.openspecstudio.domain.repository.CloneOperation
import com.sorface.openspecstudio.domain.repository.CloneRepositoryCommand
import com.sorface.openspecstudio.domain.repository.RepositoryLink
import com.sorface.openspecstudio.domain.repository.SwitchRepositoryBranchCommand
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter

data class RepositoryListResponse(val items: List<RepositoryLink>)

/** HTTP/SSE adapter context repositories. */
@RestController
@RequestMapping("/api/v1/projects/{projectId}")
internal class RepositoryController(private val service: RepositoryService) {
    @GetMapping("/repositories")
    fun list(@PathVariable projectId: String): RepositoryListResponse = RepositoryListResponse(service.list(projectId))

    @PostMapping("/repositories/{repositoryId}/branch-switches")
    fun switchBranch(
        @PathVariable projectId: String,
        @PathVariable repositoryId: String,
        @RequestBody input: SwitchRepositoryBranchCommand,
    ): RepositoryLink = service.switchBranch(projectId, repositoryId, input)

    @PostMapping("/repositories/{repositoryId}/updates")
    fun update(@PathVariable projectId: String, @PathVariable repositoryId: String): RepositoryLink =
        service.update(projectId, repositoryId)

    @PostMapping("/repository-clones")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun clone(
        @PathVariable projectId: String,
        @RequestBody input: CloneRepositoryCommand,
        request: HttpServletRequest,
    ): CloneOperation = service.startClone(projectId, input, correlationId(request))

    @GetMapping("/repository-clones/{operationId}")
    fun get(@PathVariable projectId: String, @PathVariable operationId: String): CloneOperation =
        service.get(projectId, operationId)

    @DeleteMapping("/repository-clones/{operationId}")
    fun cancel(@PathVariable projectId: String, @PathVariable operationId: String): CloneOperation =
        service.cancel(projectId, operationId)

    @GetMapping("/repository-clones/{operationId}/events", produces = [MediaType.TEXT_EVENT_STREAM_VALUE])
    fun events(
        @PathVariable projectId: String,
        @PathVariable operationId: String,
        @RequestHeader(name = "Last-Event-ID", required = false) lastEventId: String?,
    ): SseEmitter {
        service.get(projectId, operationId)
        val emitter = SseEmitter(0L)
        Thread.ofVirtual().name("repository-events-$operationId").start {
            var after = lastEventId?.toLongOrNull() ?: 0L
            var heartbeatAt = System.nanoTime()
            try {
                while (true) {
                    service.events(projectId, operationId, after).forEach { event ->
                        emitter.send(SseEmitter.event().id(event.sequence.toString()).name(event.type).data(event.payload))
                        after = event.sequence
                    }
                    if (service.get(projectId, operationId).terminal()) break
                    if (System.nanoTime() - heartbeatAt >= HEARTBEAT_NANOS) {
                        emitter.send(SseEmitter.event().comment("heartbeat"))
                        heartbeatAt = System.nanoTime()
                    }
                    Thread.sleep(100)
                }
                emitter.complete()
            } catch (exception: Exception) {
                emitter.completeWithError(exception)
            }
        }
        return emitter
    }

    private companion object {
        const val HEARTBEAT_NANOS = 15_000_000_000L
    }
}
