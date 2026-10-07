package app.pitchstudio.core

import kotlin.math.*

/** Iterative radix-2 FFT; buffers are reused by the analysis worker. */
class Fft(private val size: Int) {
    val real = DoubleArray(size)
    val imag = DoubleArray(size)
    init { require(size > 1 && size and (size - 1) == 0) }
    fun transform(inverse: Boolean = false) {
        var j = 0
        for (i in 1 until size) {
            var bit = size shr 1
            while (j and bit != 0) { j = j xor bit; bit = bit shr 1 }
            j = j xor bit
            if (i < j) {
                val r = real[i]; real[i] = real[j]; real[j] = r
                val v = imag[i]; imag[i] = imag[j]; imag[j] = v
            }
        }
        var length = 2
        while (length <= size) {
            val angle = (if (inverse) 2 else -2) * PI / length
            val wr = cos(angle); val wi = sin(angle)
            var base = 0
            while (base < size) {
                var ar = 1.0; var ai = 0.0
                for (k in 0 until length / 2) {
                    val a = base + k; val b = a + length / 2
                    val r = real[b] * ar - imag[b] * ai
                    val im = real[b] * ai + imag[b] * ar
                    real[b] = real[a] - r; imag[b] = imag[a] - im
                    real[a] += r; imag[a] += im
                    val next = ar * wr - ai * wi; ai = ar * wi + ai * wr; ar = next
                }
                base += length
            }
            length = length shl 1
        }
        if (inverse) for (i in 0 until size) { real[i] /= size; imag[i] /= size }
    }
}

/** McLeod NSDF selection ported from Pitchy (MIT, see THIRD_PARTY_NOTICES). */
class AnalysisProcessor {
    private val auto = Fft(PITCH_SIZE * 2)
    private val fft = Fft(FFT_SIZE)
    private val nsdf = DoubleArray(PITCH_SIZE)
    private val maxima = IntArray(PITCH_SIZE / 2)
    private val window = DoubleArray(FFT_SIZE) { i -> .42 - .5 * cos(2 * PI * i / FFT_SIZE) + .08 * cos(4 * PI * i / FFT_SIZE) }

    fun analyze(input: FloatArray, time: Double): AnalysisFrame {
        require(input.size == FFT_SIZE)
        val waveform = input.copyOfRange(FFT_SIZE - PITCH_SIZE, FFT_SIZE)
        var power = 0.0; var peak = 0f
        for (v in waveform) { power += v.toDouble() * v; peak = max(peak, abs(v)) }
        val rmsDb = if (power > 0) (10 * log10(power / PITCH_SIZE)).toFloat() else -160f
        val pitch = if (rmsDb >= -60) detect(waveform) else null
        for (i in input.indices) { fft.real[i] = input[i] * window[i]; fft.imag[i] = 0.0 }
        fft.transform()
        val spectrum = FloatArray(FFT_SIZE / 2) { i ->
            val mag = hypot(fft.real[i], fft.imag[i]) / FFT_SIZE
            if (mag > 0) (20 * log10(mag)).toFloat() else -160f
        }
        return AnalysisFrame(time, pitch, rmsDb, peak, waveform, spectrum)
    }

    private fun detect(input: FloatArray): Pitch? {
        for (i in auto.real.indices) { auto.real[i] = if (i < PITCH_SIZE) input[i].toDouble() else 0.0; auto.imag[i] = 0.0 }
        auto.transform()
        for (i in auto.real.indices) { auto.real[i] = auto.real[i].pow(2) + auto.imag[i].pow(2); auto.imag[i] = 0.0 }
        auto.transform(true)
        var m = 2 * auto.real[0]
        for (i in nsdf.indices) {
            nsdf[i] = if (m > 0) 2 * auto.real[i] / m else 0.0
            m -= input[i].toDouble().pow(2) + input[PITCH_SIZE - i - 1].toDouble().pow(2)
        }
        var searching = false; var top = Double.NEGATIVE_INFINITY; var index = -1; var count = 0
        for (i in 1 until PITCH_SIZE - 1) {
            if (nsdf[i - 1] <= 0 && nsdf[i] > 0) { searching = true; index = i; top = nsdf[i] }
            else if (nsdf[i - 1] > 0 && nsdf[i] <= 0) { searching = false; if (index != -1) maxima[count++] = index }
            else if (searching && nsdf[i] > top) { top = nsdf[i]; index = i }
        }
        if (count == 0) return null
        var highest = -1.0
        for (i in 0 until count) highest = max(highest, nsdf[maxima[i]])
        val chosen = (0 until count).first { nsdf[maxima[it]] >= .9 * highest }
        val k = maxima[chosen]
        val a = nsdf[k - 1]; val b = nsdf[k]; val c = nsdf[k + 1]
        val denominator = a - 2 * b + c
        val offset = if (abs(denominator) > 1e-12) .5 * (a - c) / denominator else 0.0
        val clarity = min(1.0, b - .25 * (a - c) * offset)
        val hz = SAMPLE_RATE / (k + offset)
        return if (hz.isFinite() && hz in 60.0..2200.0 && clarity >= .9) Pitch(hz, clarity) else null
    }
}

fun quantizeSpectrum(spectrum: FloatArray): ByteArray = ByteArray(BANDS) { band ->
    val lo = max(1, floor(frequencyAt(band.toDouble() / BANDS) * FFT_SIZE / SAMPLE_RATE).toInt())
    val hi = min(spectrum.lastIndex, ceil(frequencyAt((band + 1.0) / BANDS) * FFT_SIZE / SAMPLE_RATE).toInt())
    var db = -100f
    for (bin in lo..hi) db = max(db, spectrum[bin])
    (((db + 100) / 85 * 255).roundToInt().coerceIn(0, 255)).toByte()
}
data class SpectralPeak(val hz: Double, val db: Float)
fun spectralPeaks(spectrum: FloatArray): List<SpectralPeak> {
    val peaks = mutableListOf<SpectralPeak>()
    val first = ceil(50.0 * FFT_SIZE / SAMPLE_RATE).toInt()
    val last = min(spectrum.size - 2, (8000.0 * FFT_SIZE / SAMPLE_RATE).toInt())
    for (i in first..last) {
        val db = spectrum[i]
        if (db <= -80 || db <= spectrum[i - 1] || db < spectrum[i + 1]) continue
        val d = spectrum[i - 1] - 2 * db + spectrum[i + 1]
        val offset = if (d.isFinite() && abs(d) > 1e-8) (.5 * (spectrum[i - 1] - spectrum[i + 1]) / d).coerceIn(-.5, .5) else 0.0
        peaks += SpectralPeak((i + offset) * SAMPLE_RATE / FFT_SIZE, db)
    }
    return peaks.sortedByDescending { it.db }.take(5)
}
