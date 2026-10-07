package app.pitchstudio.core

import org.junit.Test
import java.io.*
import java.nio.file.Files
import kotlin.test.*

class SessionTest {
    private fun repository() = SessionRepository(Files.createTempDirectory("pitch-session-test").toFile())
    @Test fun wavFinalPartialAndSessionRoundTrip() {
        val repository = repository()
        val source = repository.create(true, InputSettings())
        val pcm = ShortArray(12345) { (it % 2000 - 1000).toShort() }
        source.appendPcm(pcm)
        val frame = AnalysisProcessor().analyze(FloatArray(FFT_SIZE) { .2f }, .2)
        source.appendFrame(frame)
        source.updateMeta(source.meta.copy(display = DisplaySettings(pitchLow = 36, pitchFollowing = false, target = 108)))
        source.finish()
        assertEquals(44 + pcm.size * 2L, source.wavFile.length())
        val bytes = ByteArrayOutputStream().also { SessionCodec.export(source, it) }.toByteArray()
        val imported = SessionCodec.import(repository, bytes.inputStream())
        assertEquals(source.meta.samples, imported.meta.samples)
        assertEquals(source.meta.display, imported.meta.display)
        assertContentEquals(source.wavFile.readBytes(), imported.wavFile.readBytes())
        assertEquals(1, imported.frames(TimeRange(0.0, 1.0)).size)
        assertTrue(imported.envelopeIndex.visible(TimeRange(0.0, 1.0), 200).isNotEmpty())
        source.close(); imported.close()
    }
    @Test fun analysisOnlyHasNoAudioAndBadImportPreservesExisting() {
        val repository = repository(); val source = repository.create(false, InputSettings())
        source.appendPcm(ShortArray(480)); source.finish()
        val bytes = ByteArrayOutputStream().also { SessionCodec.export(source, it) }.toByteArray()
        val before = repository.list().size
        assertFails { SessionCodec.import(repository, bytes.copyOf(bytes.size - 1).inputStream()) }
        assertFails { SessionCodec.import(repository, (bytes + byteArrayOf(1)).inputStream()) }
        assertEquals(before, repository.list().size)
        val imported = SessionCodec.import(repository, bytes.inputStream())
        assertFalse(imported.meta.recorded)
        assertEquals(0L, imported.wavFile.length())
        imported.close(); source.close()
    }
    @Test fun crashRecoveryKeepsOnlyCheckpointedSamples() {
        val repository = repository(); val source = repository.create(true, InputSettings())
        source.appendPcm(ShortArray(960)); source.checkpoint()
        source.appendPcm(ShortArray(480)); source.close()
        val recovered = SessionRepository(repository.root)
        val saved = recovered.list().single()
        assertTrue(saved.interrupted); assertTrue(saved.complete); assertEquals(960L, saved.samples)
        recovered.open(saved.id).use { assertEquals(1964L, it.wavFile.length()) }
    }
    @Test fun envelopeOverviewKeepsExtremaAndBoundsOutput() {
        val index = EnvelopeIndex()
        repeat(180000) { index.add(Envelope(it / 100.0, if (it == 23450) -1f else 0f, if (it == 90545) 1f else 0f)) }
        val data = index.visible(TimeRange(0.0, 1800.0), 400)
        assertTrue(data.size < 1000)
        assertEquals(-1f, data.minOf { it.min }); assertEquals(1f, data.maxOf { it.max })
    }
}
