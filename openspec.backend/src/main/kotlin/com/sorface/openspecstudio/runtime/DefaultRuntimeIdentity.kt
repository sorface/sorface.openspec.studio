package com.sorface.openspecstudio.runtime

import org.springframework.stereotype.Component

@Component
internal class DefaultRuntimeIdentity : RuntimeIdentity {
    override fun describe(): RuntimeDescriptor = RuntimeDescriptor(
        service = "OpenSpec Studio",
        language = "Kotlin",
    )
}
