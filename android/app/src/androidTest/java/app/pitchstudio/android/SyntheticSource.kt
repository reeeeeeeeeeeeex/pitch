package app.pitchstudio.android

import app.pitchstudio.core.*
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.*

/** Test-only PCM source paced by elapsed time; never included in the application APK. */
class SyntheticSource : PcmSource {
    override val settings = InputSettings(source = "instrumentation-synthetic")
    @Volatile var frequency = 220.0
    @Volatile var silent = false
    private val stopping = AtomicBoolean(false)
    private var started = 0L
    private var samples = 0L
    override fun start() { started = System.nanoTime() }
    override fun read(buffer: ShortArray): Int {
        if (stopping.get()) return -1
        val remaining = started + (samples + buffer.size) * 1_000_000_000L / SAMPLE_RATE - System.nanoTime()
        if (remaining > 0) Thread.sleep(remaining / 1_000_000, (remaining % 1_000_000).toInt())
        if (stopping.get()) return -1
        for (i in buffer.indices) {
            val phase = 2 * PI * frequency * (samples + i) / SAMPLE_RATE
            buffer[i] = if (silent) 0 else ((.2 * sin(phase) + .45 * sin(2 * phase)) * 32767).toInt().toShort()
        }
        samples += buffer.size
        return buffer.size
    }
    override fun stop() { stopping.set(true) }
    override fun close() { stopping.set(true) }
}
