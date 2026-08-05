package com.sorface.openspecstudio

/**
 * Преобразует публичные параметры прежнего backend в свойства Spring Boot.
 *
 * @author Sorface Developer
 */
object CommandLineOptions {
    /** Нормализует `--address`, `--data-dir` и `--no-browser`, сохраняя остальные аргументы. */
    fun normalize(arguments: Array<String>): Array<String> {
        val result = mutableListOf<String>()
        var index = 0
        while (index < arguments.size) {
            when (val argument = arguments[index]) {
                "--address" -> {
                    val value = requireValue(arguments, ++index, argument)
                    val address = LoopbackAddress.parse(value)
                    result += "--server.address=${address.host}"
                    result += "--server.port=${address.port}"
                    result += "--openspec.server.address=$value"
                }
                "--data-dir" -> result += "--openspec.server.data-dir=${requireValue(arguments, ++index, argument)}"
                "--no-browser" -> result += "--openspec.server.no-browser=true"
                else -> result += argument
            }
            index++
        }
        return result.toTypedArray()
    }

    private fun requireValue(arguments: Array<String>, index: Int, option: String): String =
        arguments.getOrNull(index)?.takeIf { it.isNotBlank() && !it.startsWith("--") }
            ?: throw IllegalArgumentException("Для $option требуется значение")
}
