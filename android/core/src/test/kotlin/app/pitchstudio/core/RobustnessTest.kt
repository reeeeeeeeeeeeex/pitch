package app.pitchstudio.core

import com.google.gson.JsonParser
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Test
import kotlin.concurrent.thread
import kotlin.test.*

class RobustnessTest {
    private fun repository() = SessionRepository(Files.createTempDirectory("pitch-robustness").toFile())

    @Test fun changingDisplayCannotRollBackSamples() {
        val session = repository().create(true, InputSettings())
        val ready = CountDownLatch(1)
        val writer = thread {
            ready.await()
            repeat(1000) { session.appendPcm(ShortArray(960) { 123 }); if (it % 100 == 0) session.checkpoint() }
        }
        val editor = thread {
            ready.await()
            repeat(1000) { session.updateDisplay(DisplaySettings(pitchLow = 21 + it % 64, mobileView = View.entries[it % 4].name.lowercase())) }
        }
        ready.countDown(); writer.join(); editor.join(); session.finish()
        assertEquals(960000L, session.samples)
        assertEquals(1920044L, session.wavFile.length())
        session.close()
    }

    @Test fun malformedArchivesLeaveExistingSessionsUntouched() {
        val repo = repository()
        val session = repo.create(true, InputSettings())
        session.appendPcm(ShortArray(48000))
        session.appendFrame(AnalysisFrame(.1, Pitch(220.0, 1.0), -12f, .4f, FloatArray(PITCH_SIZE), FloatArray(FFT_SIZE / 2) { -60f }))
        session.finish()
        val encoded = ByteArrayOutputStream().also { SessionCodec.export(session, it) }.toByteArray()
        val header = ByteBuffer.wrap(encoded).order(ByteOrder.LITTLE_ENDIAN)
        val length = header.getInt(8)
        val data = encoded.copyOfRange(12 + length, encoded.size)
        fun altered(edit: (com.google.gson.JsonObject) -> Unit): ByteArray {
            val manifest = JsonParser.parseString(String(encoded, 12, length, Charsets.UTF_8)).asJsonObject
            edit(manifest)
            val json = manifest.toString().toByteArray(Charsets.UTF_8)
            return "PITCHS01".toByteArray() + little(4).putInt(json.size).array() + json + data
        }
        val invalid = listOf(
            altered { it.addProperty("version", 2) },
            altered { it.addProperty("duration", 1801) },
            altered { it.getAsJsonArray("lengths").set(0, com.google.gson.JsonPrimitive(MAX_SESSION_BYTES)) },
            altered { it.getAsJsonObject("display").addProperty("pitchLow", 84.5) },
            encoded.copyOf().also { ByteBuffer.wrap(it).order(ByteOrder.LITTLE_ENDIAN).putDouble(12 + length, 2.0) },
            encoded.copyOf().also { ByteBuffer.wrap(it).order(ByteOrder.LITTLE_ENDIAN).putFloat(12 + length + 8, Float.NaN) },
            encoded.copyOf().also { it[12 + length + FRAME_BYTES + 1600 + 22] = 2 },
        )
        invalid.forEach { assertFails { SessionCodec.import(repo, it.inputStream()) } }
        assertEquals(listOf(session.meta.id), repo.list().map { it.id })
        assertEquals(1, repo.root.listFiles()!!.size)
        session.close()
    }

    @Test fun downsamplingKeepsSilentAndMissingAnalysisBreaks() {
        val session = repository().create(false, InputSettings())
        session.appendPcm(ShortArray(48000))
        val waveform = FloatArray(PITCH_SIZE); val spectrum = FloatArray(FFT_SIZE / 2) { -60f }
        for (index in 1..10) {
            val time = if (index <= 5) index * .04 else .5 + index * .04
            session.appendFrame(AnalysisFrame(time, if (index == 3) null else Pitch(220.0, 1.0), -12f, .4f, waveform, spectrum))
        }
        session.finish()
        val small = session.frames(TimeRange(0.0, 1.0), 3)
        assertTrue(small.size <= 3)
        assertTrue(small.drop(1).any { it.breakBefore })
        assertTrue(small.drop(1).any { it.gapBefore })
        assertNull(session.near(.4))
        session.close()
    }

    @Test fun storageShortageStopsAndFinishesWrittenData() {
        var closed = false
        val source = object : PcmSource {
            override val settings = InputSettings()
            override fun start() {}
            override fun read(buffer: ShortArray): Int { Thread.sleep(1); buffer.fill(1234); return buffer.size }
            override fun stop() {}
            override fun close() { closed = true }
        }
        val real = repository().create(true, InputSettings())
        val sink = object : CaptureSink by real { override fun hasSpace() = false }
        val done = CountDownLatch(1)
        var reason = ""
        val run = CapturePipeline(source, sink, {}, { reason = it; done.countDown() })
        run.start(); assertTrue(done.await(10, TimeUnit.SECONDS))
        assertTrue(closed); assertTrue(real.meta.complete); assertTrue(real.meta.interrupted)
        assertEquals(48000L, real.samples)
        assertEquals(96044L, real.wavFile.length())
        assertTrue(reason.contains("Insufficient storage space"))
        real.close()
    }
}
