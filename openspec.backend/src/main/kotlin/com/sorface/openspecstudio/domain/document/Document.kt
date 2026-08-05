package com.sorface.openspecstudio.domain.document

data class DocumentItem(val path: String, val name: String, val kind: String)
data class DocumentContent(val path: String, val content: String, val contentHash: String)
data class WriteDocumentCommand(val path: String, val content: String, val baseContentHash: String)
data class DocumentHistoryEntry(
    val hash: String,
    val shortHash: String,
    val author: String,
    val committedAt: String,
    val subject: String,
)
data class DocumentAnnotation(
    val startLine: Int,
    val endLine: Int,
    val hash: String = "",
    val shortHash: String = "",
    val author: String,
    val authorEmail: String = "",
    val authoredAt: String = "",
    val subject: String,
    val lines: List<String>,
    val local: Boolean,
)

/** Ошибка document use case с публичным API-кодом. */
class DocumentException(val code: String, override val message: String) : RuntimeException(message)
