package app.pitchstudio.core

import org.junit.Test
import kotlin.test.*
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.*

class CaptureTest {
    @Test fun drainsLastPartialChunkAndClosesSource() {
        val repo = SessionRepository(Files.createTempDirectory("capture-test").toFile())
        val sink = repo.create(true, InputSettings())
        var cursor = 0; var closed = false
        val source = object : PcmSource {
            override val settings = InputSettings()
            override fun start() {}
            override fun read(buffer: ShortArray): Int {
                if (cursor >= 12017) return -1
                val n = minOf(buffer.size, 12017 - cursor)
                repeat(n) { buffer[it] = (sin(2 * PI * 220 * (cursor + it) / SAMPLE_RATE) * 10000).toInt().toShort() }
                cursor += n; Thread.sleep(1); return n
            }
            override fun stop() {}
            override fun close() { closed = true }
        }
        val done = CountDownLatch(1)
        val pipeline = CapturePipeline(source, sink, {}, { done.countDown() })
        pipeline.start()
        assertTrue(done.await(5, TimeUnit.SECONDS))
        assertTrue(closed); assertEquals(12017L, sink.meta.samples)
        assertEquals(24078L, sink.wavFile.length()); assertTrue(sink.meta.complete)
        assertTrue(sink.frames(TimeRange(0.0, 1.0)).isNotEmpty())
        sink.close()
    }
}
