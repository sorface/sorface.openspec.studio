package com.sorface.openspecstudio.application

/** Восстанавливает операции, прерванные завершением предыдущего процесса. */
fun interface OperationRecovery {
    /** Помечает незавершённые операции ошибкой перезапуска и возвращает их количество. */
    fun recoverInterrupted(): Int
}
