package com.sorface.openspecstudio.api

import com.sorface.openspecstudio.application.DocumentService
import com.sorface.openspecstudio.domain.document.DocumentAnnotation
import com.sorface.openspecstudio.domain.document.DocumentContent
import com.sorface.openspecstudio.domain.document.DocumentHistoryEntry
import com.sorface.openspecstudio.domain.document.DocumentItem
import com.sorface.openspecstudio.domain.document.WriteDocumentCommand
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

data class DocumentListResponse(val items: List<DocumentItem>)
data class DocumentHistoryResponse(val items: List<DocumentHistoryEntry>)
data class DocumentAnnotationsResponse(val items: List<DocumentAnnotation>)

/** HTTP adapter чтения и безопасного изменения OpenSpec Markdown-документов. */
@RestController
@RequestMapping("/api/v1/projects/{projectId}/documents")
internal class DocumentController(private val service: DocumentService) {
    @GetMapping
    fun list(@PathVariable projectId: String): DocumentListResponse =
        DocumentListResponse(service.list(projectId))

    @GetMapping("/content")
    fun read(@PathVariable projectId: String, @RequestParam path: String): DocumentContent =
        service.read(projectId, path)

    @PutMapping("/content")
    fun write(@PathVariable projectId: String, @RequestBody input: WriteDocumentCommand): DocumentContent =
        service.write(projectId, input)

    @GetMapping("/history")
    fun history(@PathVariable projectId: String, @RequestParam path: String): DocumentHistoryResponse =
        DocumentHistoryResponse(service.history(projectId, path))

    @GetMapping("/annotations")
    fun annotations(@PathVariable projectId: String, @RequestParam path: String): DocumentAnnotationsResponse =
        DocumentAnnotationsResponse(service.annotations(projectId, path))
}
