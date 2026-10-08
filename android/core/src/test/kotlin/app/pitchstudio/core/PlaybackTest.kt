package app.pitchstudio.core

import java.io.File
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.file.Files
import kotlin.math.*
import kotlin.test.*
import org.junit.Test

class PlaybackTest {
    private fun wave(samples: ShortArray): File = Files.createTempFile("playback", ".wav").toFile().also { f ->
        f.writeBytes(wavHeader(samples.size.toLong()) + little(samples.size * 2).apply { samples.forEach { putShort(it) } }.array())
    }
    @Test fun quietAudioGetsBoundedGainWithoutChangingOriginalOrTiming() {
        val pcm = ShortArray(SAMPLE_RATE) { (sin(2 * PI * 220 * it / SAMPLE_RATE) * .02 * 32768).roundToInt().toShort() }
        val file = wave(pcm); val original = file.readBytes()
        PlaybackWav(file, playbackGain(.02f)).use { wav ->
            assertEquals(16f, wav.gain)
            val result = ByteArray(wav.size.toInt()); var offset = 0
            while (offset < result.size) offset += wav.readAt(offset.toLong(), result, offset, result.size - offset)
            assertContentEquals(original.copyOf(44), result.copyOf(44))
            val decoded = ByteBuffer.wrap(result).order(ByteOrder.LITTLE_ENDIAN).apply { position(44) }
            var before = 0.0; var after = 0.0
            for (sample in pcm) {
                val amplified = decoded.short
                assertEquals(sample.toInt() * 16, amplified.toInt())
                before += sample.toDouble().pow(2); after += amplified.toDouble().pow(2)
            }
            assertEquals(24.0824, 10 * log10(after / before), .0001)
        }
        assertContentEquals(original, file.readBytes()); file.delete()
    }
    @Test fun silenceLoudAudioAndNonFinitePeaksAreNotAmplified() {
        for (peak in listOf(0f, .0001f, .8f, 1f, Float.NaN, Float.POSITIVE_INFINITY)) assertEquals(1f, playbackGain(peak))
        assertEquals(.7079458f, playbackGain(.1f) * .1f, .000001f)
        val file = wave(shortArrayOf(0, -32768, 32767))
        PlaybackWav(file, 1f).use { wav ->
            val bytes = ByteArray(wav.size.toInt()); wav.readAt(0, bytes, 0, bytes.size)
            assertContentEquals(file.readBytes(), bytes)
        }
        file.delete()
    }
    @Test fun arbitraryByteReadsAndSeeksMatchSequentialPlayback() {
        val pcm = ShortArray(40001) { ((it % 3000) - 1500).toShort() }; val file = wave(pcm)
        val expected = wavHeader(pcm.size.toLong()) + little(pcm.size * 2).apply { pcm.forEach { putShort((it * 4).toShort()) } }.array()
        PlaybackWav(file, 4f).use { wav ->
            for (position in listOf(0, 1, 40, 43, 44, 45, 123, 65535, expected.lastIndex)) {
                for (length in listOf(1, 2, 7, 65536, 70000)) {
                    val result = ByteArray(length + 10) { 0x55 }
                    val count = wav.readAt(position.toLong(), result, 3, length)
                    assertContentEquals(expected.copyOfRange(position, position + count), result.copyOfRange(3, 3 + count))
                    assertEquals(0x55.toByte(), result[2]); assertEquals(0x55.toByte(), result[3 + count])
                }
            }
            assertEquals(0, wav.readAt(wav.size, ByteArray(0), 0, 0))
            assertEquals(-1, wav.readAt(wav.size, ByteArray(1), 0, 1))
        }
        file.delete()
    }
    @Test fun coarseEnvelopeIncludesFinalPartialBlockWhenChoosingSafeGain() {
        val root = Files.createTempDirectory("playback-peak").toFile()
        SessionRepository(root).create(true, InputSettings()).use { session ->
            session.appendPcm(ShortArray(48000) { 100 }); session.appendPcm(shortArrayOf(30000)); session.finish()
            val peak = session.envelopeIndex.visible(TimeRange(0.0, session.meta.duration), 1).maxOf { max(abs(it.min), abs(it.max)) }
            assertEquals(1f, playbackGain(peak))
        }
        root.deleteRecursively()
    }
    @Test fun invalidPeakMetadataCannotOverflowPcmAndCloseIsIdempotent() {
        val file = wave(shortArrayOf(30000, -30000))
        val wav = PlaybackWav(file, 16f); val bytes = ByteArray(4)
        wav.readAt(44, bytes, 0, 4)
        val output = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals(32767, output.short.toInt()); assertEquals(-32768, output.short.toInt())
        wav.close(); wav.close()
        assertFailsWith<IOException> { wav.readAt(44, bytes, 0, 4) }; file.delete()
    }
}
