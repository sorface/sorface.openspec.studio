package com.sorface.openspecstudio

import java.net.Inet6Address
import java.net.InetAddress

/** Проверенный адрес локального HTTP-сервера. */
data class LoopbackAddress(val host: String, val port: Int) {
    companion object {
        /** Разбирает адрес и запрещает прослушивание внешнего интерфейса. */
        fun parse(value: String): LoopbackAddress {
            val host: String
            val portText: String
            if (value.startsWith("[")) {
                val closingBracket = value.indexOf(']')
                require(closingBracket > 1 && value.getOrNull(closingBracket + 1) == ':') {
                    "Некорректный адрес сервера"
                }
                host = value.substring(1, closingBracket)
                portText = value.substring(closingBracket + 2)
            } else {
                val separator = value.lastIndexOf(':')
                require(separator > 0) { "Некорректный адрес сервера" }
                host = value.substring(0, separator)
                portText = value.substring(separator + 1)
            }
            val port = portText.toIntOrNull()
            require(port != null && port in 0..65535) { "Некорректный порт сервера" }
            requireHost(host)
            return LoopbackAddress(host, port)
        }

        /** Запрещает hostname и адреса, которые могут открыть backend во внешнюю сеть. */
        fun requireHost(host: String) {
            require(isLoopbackLiteralOrLocalhost(host)) { "Адрес сервера должен использовать loopback-интерфейс" }
        }

        private fun isLoopbackLiteralOrLocalhost(host: String): Boolean {
            if (host == "localhost") return true
            val looksLikeIpv4 = host.matches(Regex("[0-9.]+"))
            val looksLikeIpv6 = host.contains(':') && host.matches(Regex("[0-9A-Fa-f:]+"))
            if (!looksLikeIpv4 && !looksLikeIpv6) return false
            val address = runCatching { InetAddress.getByName(host) }.getOrNull() ?: return false
            return address.isLoopbackAddress && (looksLikeIpv4 || address is Inet6Address)
        }
    }
}
