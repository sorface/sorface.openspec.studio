package com.sorface.openspecstudio.api

import com.sorface.openspecstudio.application.ProjectService
import com.sorface.openspecstudio.domain.project.CreateProjectCommand
import com.sorface.openspecstudio.domain.project.CreateProjectFromGitCommand
import com.sorface.openspecstudio.domain.project.Project
import com.sorface.openspecstudio.domain.project.UpdateProjectCommand
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

data class ProjectListResponse(val items: List<Project>)

/** HTTP adapter управления локальными проектами. */
@RestController
@RequestMapping("/api/v1/projects")
internal class ProjectController(private val service: ProjectService) {
    @GetMapping
    fun list(): ProjectListResponse = ProjectListResponse(service.list())

    @GetMapping("/{projectId}")
    fun get(@PathVariable projectId: String): Project = service.get(projectId)

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun create(@RequestBody input: CreateProjectCommand): Project = service.create(input)

    @PostMapping("/from-git")
    @ResponseStatus(HttpStatus.CREATED)
    fun createFromGit(@RequestBody input: CreateProjectFromGitCommand): Project = service.createFromGit(input)

    @PatchMapping("/{projectId}")
    fun update(@PathVariable projectId: String, @RequestBody input: UpdateProjectCommand): Project =
        service.update(projectId, input)

    @DeleteMapping("/{projectId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun delete(@PathVariable projectId: String) = service.delete(projectId)
}
