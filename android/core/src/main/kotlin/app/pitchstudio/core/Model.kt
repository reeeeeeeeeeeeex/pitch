package app.pitchstudio.core

import kotlin.math.*

const val SAMPLE_RATE = 48000
const val MAX_SECONDS = 1800
const val MAX_SAMPLES = SAMPLE_RATE.toLong() * MAX_SECONDS
const val PITCH_SIZE = 4096
const val FFT_SIZE = 8192
const val BANDS = 512
const val FRAME_BYTES = 536
const val MAX_SESSION_BYTES = 256L * 1024 * 1024

data class Pitch(val hz: Double, val clarity: Double) {
    val midi: Double get() = 69 + 12 * log2(hz / 440)
    val note: Int get() = midi.roundToInt()
    val cents: Double get() = (midi - note) * 100
}
data class AnalysisFrame(
    val time: Double, val pitch: Pitch?, val rmsDb: Float, val peak: Float,
    val waveform: FloatArray, val spectrum: FloatArray,
)
data class HistoryFrame(val time: Double, val hz: Float, val clarity: Float,
    val rmsDb: Float, val peak: Float, val spectrum: ByteArray)
data class Envelope(val time: Double, val min: Float, val max: Float)
data class TimeRange(val start: Double, val end: Double) { val span get() = max(.001, end - start) }
enum class View { PITCH, SPECTROGRAM, WAVEFORM, SPECTRUM }
data class DisplaySettings(
    val view: String = "spectrogram", val mobileView: String = "pitch",
    val windowSeconds: Int = 30, val target: Int? = null,
    val milliseconds: Int = 20, val gain: Int = 1,
    val pitchLow: Int = 48, val pitchFollowing: Boolean = true,
)
data class InputSettings(
    val sampleRate: Int = SAMPLE_RATE, val source: String = "",
    val device: String = "", val echoCancellation: Boolean? = null,
    val noiseSuppression: Boolean? = null, val autoGainControl: Boolean? = null,
)
data class SessionMeta(
    val id: String, val name: String, val createdAt: String,
    val recorded: Boolean, val samples: Long = 0,
    val historyBytes: Long = 0, val envelopeBytes: Long = 0,
    val interrupted: Boolean = false, val complete: Boolean = false,
    val reason: String = "", val settings: InputSettings = InputSettings(),
    val display: DisplaySettings = DisplaySettings(),
) { val duration: Double get() = samples.toDouble() / SAMPLE_RATE }

fun noteName(midi: Int): String = arrayOf("C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B")[Math.floorMod(midi, 12)] + (midi / 12 - 1)
fun midiToHz(midi: Int) = 440 * 2.0.pow((midi - 69) / 12.0)
fun followPitch(low: Int, midi: Double?): Int {
    if (midi == null || !midi.isFinite()) return low
    return when {
        midi < low || midi > low + 24 -> (midi - 12).roundToInt()
        midi < low + 5 -> floor(midi).toInt() - 5
        midi > low + 19 -> ceil(midi).toInt() - 19
        else -> low
    }.coerceIn(21, 84)
}
fun timeRange(duration: Double, seconds: Int, following: Boolean, start: Double): TimeRange {
    val span = if (seconds == 0) max(1.0, duration) else seconds.toDouble()
    val left = if (following) max(0.0, duration - span) else start.coerceIn(0.0, max(0.0, duration - span))
    return TimeRange(left, left + span)
}
fun formatTime(seconds: Double): String {
    val s = max(0, seconds.toInt())
    return "%02d:%02d".format(java.util.Locale.ROOT, s / 60, s % 60)
}
fun frequencyAt(ratio: Double) = 50 * 160.0.pow(ratio)
fun frequencyRatio(hz: Double) = ln(hz / 50) / ln(160.0)
