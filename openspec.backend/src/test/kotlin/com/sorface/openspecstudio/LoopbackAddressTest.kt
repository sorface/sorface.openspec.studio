package com.sorface.openspecstudio

import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatIllegalArgumentException
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.context.support.GenericApplicationContext
import org.springframework.mock.env.MockEnvironment

@DisplayName("Loopback address локального server")
class LoopbackAddressTest {
    @Test
    @DisplayName("разбирает localhost, IPv4 и IPv6")
    fun parsesSupportedAddresses() {
        assertThat(LoopbackAddress.parse("localhost:0")).isEqualTo(LoopbackAddress("localhost", 0))
        assertThat(LoopbackAddress.parse("127.0.0.1:65535")).isEqualTo(LoopbackAddress("127.0.0.1", 65535))
        assertThat(LoopbackAddress.parse("[::1]:8787")).isEqualTo(LoopbackAddress("::1", 8787))
    }

    @Test
    @DisplayName("отклоняет hostname, внешний IP и некорректный port")
    fun rejectsUnsafeAddresses() {
        for (value in listOf("example.com:80", "192.168.1.2:80", "127.0.0.1:65536", "invalid")) {
            assertThatIllegalArgumentException().isThrownBy { LoopbackAddress.parse(value) }
        }
    }

    @Test
    @DisplayName("отклоняет внешний Spring bind address до запуска server")
    fun rejectsExternalSpringBindAddress() {
        val context = GenericApplicationContext().apply {
            environment = MockEnvironment().withProperty("server.address", "0.0.0.0")
        }

        assertThatIllegalArgumentException()
            .isThrownBy { LoopbackServerInitializer().initialize(context) }
            .withMessageContaining("loopback")
    }
}
