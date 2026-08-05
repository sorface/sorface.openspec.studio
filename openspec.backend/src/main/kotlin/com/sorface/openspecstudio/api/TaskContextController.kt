package com.sorface.openspecstudio.api

import com.sorface.openspecstudio.application.PublicationService
import com.sorface.openspecstudio.application.TaskWorkspaceService
import com.sorface.openspecstudio.config.correlationId
import com.sorface.openspecstudio.domain.taskcontext.ConfirmPublicationCommand
import com.sorface.openspecstudio.domain.taskcontext.GeneratePublicationMessageCommand
import com.sorface.openspecstudio.domain.taskcontext.OpenTaskWorkspaceCommand
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

/** HTTP adapter task worktree и scoped publication workflows. */
@RestController
@RequestMapping("/api/v1/projects/{projectId}")
internal class TaskContextController(
    private val workspaces: TaskWorkspaceService,
    private val publications: PublicationService,
) {
    @GetMapping("/task-workspaces") fun list(@PathVariable projectId: String) = workspaces.list(projectId)
    @PostMapping("/task-workspaces") fun open(@PathVariable projectId: String, @RequestBody input: OpenTaskWorkspaceCommand) = workspaces.open(projectId, input)
    @PostMapping("/task-workspaces/sync") fun sync(@PathVariable projectId: String) = workspaces.sync(projectId)
    @PostMapping("/task-publications/preview") fun preview(@PathVariable projectId: String) = publications.preview(projectId)
    @PostMapping("/task-publications/message")
    fun generate(@PathVariable projectId: String, @RequestBody input: GeneratePublicationMessageCommand) = publications.generate(projectId, input)
    @PostMapping("/task-publications") @ResponseStatus(HttpStatus.ACCEPTED)
    fun publish(@PathVariable projectId: String, @RequestBody input: ConfirmPublicationCommand, request: HttpServletRequest) =
        publications.confirm(projectId, input, correlationId(request))
}
