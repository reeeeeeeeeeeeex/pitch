package app.pitchstudio.core

import kotlin.math.*
import kotlin.test.*
import org.junit.Test

class AnalysisTest {
    private fun tone(hz: Double, harmonic: Double = 0.0) = FloatArray(FFT_SIZE) { i -> (.2 * sin(2 * PI * hz * i / SAMPLE_RATE) + harmonic * sin(4 * PI * hz * i / SAMPLE_RATE)).toFloat() }
    @Test fun pureNotesAndStrongerHarmonic() {
        val processor = AnalysisProcessor()
        for (hz in listOf(110.0, 220.0, 440.0, 880.0)) {
            val pitch = assertNotNull(processor.analyze(tone(hz), .2).pitch)
            assertTrue(abs(1200 * log2(pitch.hz / hz)) < 5, "$hz: ${pitch.hz}")
        }
        val frame = processor.analyze(tone(220.0, .5), .2)
        assertTrue(abs(assertNotNull(frame.pitch).hz - 220) < 1)
        val peaks = spectralPeaks(frame.spectrum)
        assertTrue(peaks.any { abs(it.hz - 220) < 3 })
        assertTrue(peaks.any { abs(it.hz - 440) < 3 })
        assertEquals(512, quantizeSpectrum(frame.spectrum).size)
    }
    @Test fun silenceAndNoiseHaveNoReliablePitch() {
        val processor = AnalysisProcessor()
        assertNull(processor.analyze(FloatArray(FFT_SIZE), 0.0).pitch)
        val random = java.util.Random(1)
        assertNull(processor.analyze(FloatArray(FFT_SIZE) { random.nextFloat() * 2 - 1 }, .2).pitch)
    }
    @Test fun viewportFollowsAndRemainsBounded() {
        assertEquals(48, followPitch(48, 60.0))
        assertEquals(69, followPitch(36, 81.0))
        assertEquals(21, followPitch(48, 21.0))
        assertEquals(84, followPitch(48, 108.0))
        assertEquals(TimeRange(0.0, 30.0), timeRange(18.0, 30, true, 0.0))
        assertEquals(TimeRange(90.0, 120.0), timeRange(120.0, 30, true, 0.0))
        assertEquals(TimeRange(0.0, 30.0), timeRange(120.0, 30, false, 0.0))
    }
}
