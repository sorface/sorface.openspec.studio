package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.domain.taskcontext.GeneratedCommitMessage
import com.sorface.openspecstudio.domain.taskcontext.PublicationMessageRequest
import com.sorface.openspecstudio.domain.taskcontext.TaskWorkspace

interface TaskWorkspaceRepository {
    fun list(projectId: String): List<TaskWorkspace>
    fun findByBranch(projectId: String, branch: String): TaskWorkspace?
    fun create(workspace: TaskWorkspace): TaskWorkspace
    fun activate(projectId: String, workspaceId: String): Boolean
}
/** Опциональный AI adapter генерации publication commit message. */
fun interface PublicationMessageGenerator {
    fun generate(request: PublicationMessageRequest): GeneratedCommitMessage
}
