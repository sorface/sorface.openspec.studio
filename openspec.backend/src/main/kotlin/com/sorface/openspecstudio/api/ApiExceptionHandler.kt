package com.sorface.openspecstudio.api

import com.sorface.openspecstudio.config.correlationId
import com.sorface.openspecstudio.domain.document.DocumentException
import com.sorface.openspecstudio.domain.ai.AiException
import com.sorface.openspecstudio.domain.git.GitException
import com.sorface.openspecstudio.domain.openspec.OpenSpecException
import com.sorface.openspecstudio.domain.project.ProjectException
import com.sorface.openspecstudio.domain.repository.RepositoryException
import com.sorface.openspecstudio.domain.taskcontext.TaskContextException
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.slf4j.LoggerFactory
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.http.converter.HttpMessageNotReadableException

/** Скрывает внутренние исключения за стабильным API-контрактом. */
@RestControllerAdvice
internal class ApiExceptionHandler {
    @ExceptionHandler(AiException::class)
    fun ai(exception: AiException, request: HttpServletRequest): ResponseEntity<ApiErrorEnvelope> {
        val status = when (exception.code) {
            "INVALID_AI_CONTEXT", "AI_PROVIDER_UNSUPPORTED", "AI_SCOPE_VIOLATION" -> HttpStatus.BAD_REQUEST
            "AI_PROVIDER_UNAVAILABLE", "AI_OPERATION_CONFLICT", "AI_CONTEXT_STALE" -> HttpStatus.CONFLICT
            else -> HttpStatus.INTERNAL_SERVER_ERROR
        }
        return ResponseEntity.status(status).body(ApiErrorEnvelope(ApiError(exception.code, exception.message, correlationId = correlationId(request))))
    }

    @ExceptionHandler(OpenSpecException::class)
    fun openspec(exception: OpenSpecException, request: HttpServletRequest): ResponseEntity<ApiErrorEnvelope> {
        val status = when (exception.code) {
            "INVALID_OPENSPEC_CHANGE", "OPENSPEC_CHANGE_INVALID", "INVALID_CREATION_DRAFT", "OPENSPEC_DELETE_CONFIRMATION" -> HttpStatus.BAD_REQUEST
            "TOOL_UNAVAILABLE", "OPENSPEC_UNAVAILABLE", "TOOL_VERSION_UNSUPPORTED", "OPENSPEC_VERSION_UNSUPPORTED",
            "OPENSPEC_READ_ONLY_VIOLATION", "OPENSPEC_STATUS_STALE", "OPENSPEC_ACTION_BLOCKED", "OPENSPEC_VALIDATION_FAILED",
            "OPENSPEC_OPERATION_CONFLICT", "OPENSPEC_DRAFT_CONFLICT", "OPENSPEC_DRAFT_INVALID", "OPENSPEC_DRAFT_ALREADY_WRITTEN",
            "OPENSPEC_PROVIDER_UNAVAILABLE" -> HttpStatus.CONFLICT
            "OPENSPEC_COMMAND_FAILED", "OPENSPEC_EXPLORE_INVALID" -> HttpStatus.BAD_GATEWAY
            else -> HttpStatus.INTERNAL_SERVER_ERROR
        }
        return ResponseEntity.status(status).body(ApiErrorEnvelope(ApiError(exception.code, exception.message, correlationId = correlationId(request))))
    }

    @ExceptionHandler(TaskContextException::class)
    fun taskContext(exception: TaskContextException, request: HttpServletRequest): ResponseEntity<ApiErrorEnvelope> {
        val status = when (exception.code) {
            "TASK_BRANCH_INVALID", "PUBLICATION_SCOPE_INVALID" -> HttpStatus.BAD_REQUEST
            "TASK_REMOTE_BRANCH_NOT_FOUND", "TASK_WORKSPACE_NOT_FOUND" -> HttpStatus.NOT_FOUND
            "TASK_SYNC_FAILED" -> HttpStatus.BAD_GATEWAY
            "PUBLICATION_MESSAGE_UNAVAILABLE" -> HttpStatus.SERVICE_UNAVAILABLE
            "GIT_UNAVAILABLE", "TASK_WORKSPACE_CONFLICT", "TASK_WORKSPACE_UNAVAILABLE",
            "TASK_SYNC_UPSTREAM_UNAVAILABLE", "TASK_SYNC_CONFLICT", "PUBLICATION_EMPTY", "PUBLICATION_STALE",
            "PUBLICATION_REMOTE_UNAVAILABLE", "PUBLICATION_REMOTE_CHANGED", "PUBLICATION_AUTH_FAILED", "PUBLICATION_IN_PROGRESS" -> HttpStatus.CONFLICT
            "PUBLICATION_FAILED" -> HttpStatus.INTERNAL_SERVER_ERROR
            else -> HttpStatus.INTERNAL_SERVER_ERROR
        }
        return ResponseEntity.status(status).body(ApiErrorEnvelope(ApiError(exception.code, exception.message, correlationId = correlationId(request))))
    }

    @ExceptionHandler(GitException::class)
    fun git(exception: GitException, request: HttpServletRequest): ResponseEntity<ApiErrorEnvelope> {
        val status = when (exception.code) {
            "GIT_EMPTY_SELECTION", "INVALID_STORE_PATH", "GIT_INVALID_COMMIT_MESSAGE", "GIT_INVALID_BRANCH" -> HttpStatus.BAD_REQUEST
            "GIT_BRANCH_NOT_FOUND", "GIT_REMOTE_NOT_FOUND" -> HttpStatus.NOT_FOUND
            "GIT_TIMEOUT" -> HttpStatus.GATEWAY_TIMEOUT
            "GIT_HEAD_CHANGED", "GIT_INDEX_CHANGED", "WORKTREE_DIRTY", "GIT_BRANCH_EXISTS", "GIT_DETACHED_HEAD",
            "GIT_OPERATION_CONFLICT", "GIT_AUTH_FAILED", "GIT_NON_FAST_FORWARD", "GIT_OPERATION_FAILED", "GIT_UNAVAILABLE" -> HttpStatus.CONFLICT
            else -> HttpStatus.INTERNAL_SERVER_ERROR
        }
        return ResponseEntity.status(status).body(ApiErrorEnvelope(ApiError(exception.code, exception.message, correlationId = correlationId(request))))
    }

    @ExceptionHandler(RepositoryException::class)
    fun repository(exception: RepositoryException, request: HttpServletRequest): ResponseEntity<ApiErrorEnvelope> {
        val status = when (exception.code) {
            "INVALID_GIT_URL", "PATH_OUTSIDE_SCOPE", "GIT_BRANCH_NOT_FOUND" -> HttpStatus.BAD_REQUEST
            "GIT_TIMEOUT" -> HttpStatus.GATEWAY_TIMEOUT
            "REPOSITORY_CLONE_CONFLICT", "WORKTREE_DIRTY", "GIT_BRANCH_EXISTS", "GIT_UPSTREAM_MISSING",
            "GIT_FAST_FORWARD_REQUIRED", "GIT_AUTH_FAILED", "SSH_HOST_KEY_FAILED", "GIT_REPOSITORY_NOT_FOUND",
            "GIT_OPERATION_FAILED", "GIT_CLONE_FAILED", "GIT_UNAVAILABLE" -> HttpStatus.CONFLICT
            else -> HttpStatus.INTERNAL_SERVER_ERROR
        }
        return ResponseEntity.status(status).body(
            ApiErrorEnvelope(ApiError(exception.code, exception.message, correlationId = correlationId(request))),
        )
    }

    @ExceptionHandler(DocumentException::class)
    fun document(exception: DocumentException, request: HttpServletRequest): ResponseEntity<ApiErrorEnvelope> {
        val status = when (exception.code) {
            "DOCUMENT_NOT_FOUND" -> HttpStatus.NOT_FOUND
            "DRAFT_CONFLICT", "GIT_UNAVAILABLE" -> HttpStatus.CONFLICT
            "DOCUMENT_TOO_LARGE" -> HttpStatus.PAYLOAD_TOO_LARGE
            "PATH_OUTSIDE_SCOPE", "INVALID_DOCUMENT_CONTENT", "INVALID_STORE" -> HttpStatus.BAD_REQUEST
            else -> HttpStatus.INTERNAL_SERVER_ERROR
        }
        return ResponseEntity.status(status).body(
            ApiErrorEnvelope(ApiError(exception.code, exception.message, correlationId = correlationId(request))),
        )
    }

    @ExceptionHandler(ProjectException::class)
    fun project(exception: ProjectException, request: HttpServletRequest): ResponseEntity<ApiErrorEnvelope> {
        val status = when (exception.code) {
            "PROJECT_NOT_FOUND" -> HttpStatus.NOT_FOUND
            "CLONE_TARGET_NOT_EMPTY", "GIT_UNAVAILABLE", "GIT_AUTH_FAILED", "SSH_HOST_KEY_FAILED", "GIT_CLONE_FAILED" ->
                HttpStatus.CONFLICT
            else -> HttpStatus.BAD_REQUEST
        }
        return ResponseEntity.status(status).body(
            ApiErrorEnvelope(ApiError(exception.code, exception.message, correlationId = correlationId(request))),
        )
    }

    @ExceptionHandler(HttpMessageNotReadableException::class)
    fun malformed(request: HttpServletRequest): ResponseEntity<ApiErrorEnvelope> = ResponseEntity.badRequest().body(
        ApiErrorEnvelope(ApiError("INVALID_REQUEST", "Некорректный JSON", correlationId = correlationId(request))),
    )

    @ExceptionHandler(Exception::class)
    fun unexpected(request: HttpServletRequest, exception: Exception): ResponseEntity<ApiErrorEnvelope> {
        logger.error("Необработанная ошибка API, correlationId={}", correlationId(request), exception)
        return ResponseEntity
            .status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(ApiErrorEnvelope(ApiError("INTERNAL_ERROR", "Внутренняя ошибка", correlationId = correlationId(request))))
    }

    private companion object {
        val logger = LoggerFactory.getLogger(ApiExceptionHandler::class.java)
    }
}
