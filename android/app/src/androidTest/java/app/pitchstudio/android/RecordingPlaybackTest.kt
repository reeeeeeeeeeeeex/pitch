package app.pitchstudio.android

import android.media.MediaExtractor
import android.media.MediaFormat
import androidx.test.platform.app.InstrumentationRegistry
import app.pitchstudio.android.audio.PlaybackDataSource
import app.pitchstudio.android.audio.RecordingPlayer
import app.pitchstudio.core.*
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.*
import org.junit.Assert.*
import org.junit.Test

class RecordingPlaybackTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private fun recording(): SessionHandle {
        val root = File(instrumentation.targetContext.cacheDir, "playback-test-${System.nanoTime()}")
        return SessionRepository(root).create(true, InputSettings()).also { session ->
            val pcm = ShortArray(48000) { (sin(2 * PI * 220 * it / SAMPLE_RATE) * .02 * 32768).roundToInt().toShort() }
            repeat(4) { session.appendPcm(pcm) }; session.finish()
        }
    }
    @Test fun platformExtractorReceivesAmplifiedPcmWithUnchangedDuration() {
        recording().use { session ->
            val original = session.wavFile.readBytes()
            val source = PlaybackDataSource(PlaybackWav(session.wavFile, playbackGain(.02f)))
            val extractor = MediaExtractor()
            try {
                extractor.setDataSource(source); extractor.selectTrack(0)
                val format = extractor.getTrackFormat(0)
                assertEquals(SAMPLE_RATE, format.getInteger(MediaFormat.KEY_SAMPLE_RATE))
                assertEquals(1, format.getInteger(MediaFormat.KEY_CHANNEL_COUNT))
                assertEquals(4_000_000L, format.getLong(MediaFormat.KEY_DURATION))
                val buffer = ByteBuffer.allocate(65536).order(ByteOrder.LITTLE_ENDIAN)
                var samples = 0; var peak = 0
                while (true) {
                    buffer.clear(); val count = extractor.readSampleData(buffer, 0)
                    if (count < 0) break
                    for (i in 0 until count / 2) peak = max(peak, abs(buffer.getShort(i * 2).toInt()))
                    samples += count / 2; extractor.advance()
                }
                assertEquals(4 * SAMPLE_RATE, samples)
                assertTrue("Decoded peak $peak", peak in 10400..10500)
                assertArrayEquals(original, session.wavFile.readBytes())
            } finally { extractor.release(); source.close() }
        }
    }
    @Test fun enhancedPlayerSupportsPauseSeekCompletionAndRepeatedRelease() {
        recording().use { session ->
            val complete = CountDownLatch(1); var failure = false
            lateinit var player: RecordingPlayer
            instrumentation.runOnMainSync {
                player = RecordingPlayer(session, { complete.countDown() }, { failure = true; complete.countDown() })
                assertEquals(16f, player.gain, .001f); player.start()
            }
            try {
                Thread.sleep(500)
                instrumentation.runOnMainSync { assertTrue(player.isPlaying); assertTrue(player.currentPosition > 0); player.pause() }
                var paused = 0
                instrumentation.runOnMainSync { paused = player.currentPosition }
                Thread.sleep(150)
                instrumentation.runOnMainSync { assertFalse(player.isPlaying); assertEquals(paused, player.currentPosition); player.seekTo(3000) }
                Thread.sleep(150)
                instrumentation.runOnMainSync { assertTrue(abs(player.currentPosition - 3000) < 150); player.start() }
                assertTrue(complete.await(5, TimeUnit.SECONDS)); assertFalse(failure)
                instrumentation.runOnMainSync { assertFalse(player.isPlaying) }
            } finally { instrumentation.runOnMainSync { player.release(); player.release() } }
        }
    }
}
