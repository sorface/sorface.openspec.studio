package com.sorface.openspecstudio.api

import com.sorface.openspecstudio.application.GitService
import com.sorface.openspecstudio.config.correlationId
import com.sorface.openspecstudio.domain.git.GitCommitCommand
import com.sorface.openspecstudio.domain.git.GitCreateBranchCommand
import com.sorface.openspecstudio.domain.git.GitFetchCommand
import com.sorface.openspecstudio.domain.git.GitOperation
import com.sorface.openspecstudio.domain.git.GitPathsCommand
import com.sorface.openspecstudio.domain.git.GitPushCommand
import com.sorface.openspecstudio.domain.git.GitStatus
import com.sorface.openspecstudio.domain.git.GitSwitchBranchCommand
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

/** HTTP/SSE adapter Git Store операций. */
@RestController
@RequestMapping("/api/v1/projects/{projectId}/git")
internal class GitController(private val service: GitService) {
    @GetMapping("/status") fun status(@PathVariable projectId: String): GitStatus = service.status(projectId)
    @PostMapping("/stage") fun stage(@PathVariable projectId: String, @RequestBody input: GitPathsCommand) = service.stage(projectId, input)
    @PostMapping("/unstage") fun unstage(@PathVariable projectId: String, @RequestBody input: GitPathsCommand) = service.unstage(projectId, input)
    @PostMapping("/commits") @ResponseStatus(HttpStatus.CREATED)
    fun commit(@PathVariable projectId: String, @RequestBody input: GitCommitCommand) = service.commit(projectId, input)
    @PostMapping("/branches") @ResponseStatus(HttpStatus.CREATED)
    fun createBranch(@PathVariable projectId: String, @RequestBody input: GitCreateBranchCommand) = service.createBranch(projectId, input)
    @PostMapping("/branch-switches") fun switchBranch(@PathVariable projectId: String, @RequestBody input: GitSwitchBranchCommand) = service.switchBranch(projectId, input)
    @PostMapping("/fetches") @ResponseStatus(HttpStatus.ACCEPTED)
    fun fetch(@PathVariable projectId: String, @RequestBody input: GitFetchCommand, request: HttpServletRequest): GitOperation =
        service.startFetch(projectId, input, correlationId(request))
    @PostMapping("/pushes") @ResponseStatus(HttpStatus.ACCEPTED)
    fun push(@PathVariable projectId: String, @RequestBody input: GitPushCommand, request: HttpServletRequest): GitOperation =
        service.startPush(projectId, input, correlationId(request))
    @GetMapping("/operations/{operationId}")
    fun operation(@PathVariable projectId: String, @PathVariable operationId: String) = service.operation(projectId, operationId)
    @DeleteMapping("/operations/{operationId}")
    fun cancel(@PathVariable projectId: String, @PathVariable operationId: String) = service.cancel(projectId, operationId)

    @GetMapping("/operations/{operationId}/events", produces = [MediaType.TEXT_EVENT_STREAM_VALUE])
    fun events(@PathVariable projectId: String, @PathVariable operationId: String,
               @RequestHeader(name = "Last-Event-ID", required = false) lastEventId: String?): SseEmitter {
        service.operation(projectId, operationId)
        val emitter = SseEmitter(0L)
        Thread.ofVirtual().name("git-events-$operationId").start {
            var after = lastEventId?.toLongOrNull() ?: 0L
            try {
                while (true) {
                    service.events(projectId, operationId, after).forEach { event ->
                        emitter.send(SseEmitter.event().id(event.sequence.toString()).name(event.type).data(event.payload))
                        after = event.sequence
                    }
                    if (service.operation(projectId, operationId).terminal()) break
                    Thread.sleep(100)
                }
                emitter.complete()
            } catch (exception: Exception) { emitter.completeWithError(exception) }
        }
        return emitter
    }
}
