package com.sorface.openspecstudio.infrastructure.process

import com.sorface.openspecstudio.application.ProcessCancellation
import jakarta.annotation.PreDestroy
import org.springframework.stereotype.Component
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/** Управляет взаимно заменяемыми cancellable process scopes по operation id. */
@Component
class ProcessSupervisor : AutoCloseable {
    private val tokens = ConcurrentHashMap<String, Token>()

    /** Создаёт scope, отменяя прежний запуск с тем же id. */
    fun open(id: String): ProcessScope {
        require(id.isNotBlank()) { "Operation id must not be blank" }
        val token = Token()
        tokens.put(id, token)?.cancel()
        return ProcessScope(token) { tokens.remove(id, token) }
    }

    /** Отменяет активный scope. */
    fun cancel(id: String): Boolean = tokens[id]?.also(Token::cancel) != null

    /** Отменяет все процессы при остановке приложения. */
    @PreDestroy
    override fun close() { tokens.values.forEach(Token::cancel); tokens.clear() }

    private class Token : ProcessCancellation {
        private val cancelled = AtomicBoolean()
        override fun isCancelled(): Boolean = cancelled.get()
        fun cancel() = cancelled.set(true)
    }

    class ProcessScope internal constructor(
        val cancellation: ProcessCancellation,
        private val release: () -> Unit,
    ) : AutoCloseable {
        override fun close() = release()
    }
}
