package app.pitchstudio.android.ui

import android.content.Context
import android.graphics.*
import android.net.Uri
import app.pitchstudio.android.StudioState
import app.pitchstudio.core.*
import kotlin.math.*

object ChartRenderer {
    val background = Color.rgb(16, 21, 16)
    val accent = Color.rgb(191, 231, 131)
    val muted = Color.rgb(146, 159, 137)
    private val grid = Color.rgb(43, 53, 43)
    private val colors = IntArray(256) { i ->
        val t = i / 255f
        when {
            t < .35f -> mix(Color.rgb(17, 24, 25), Color.rgb(42, 66, 97), t / .35f)
            t < .7f -> mix(Color.rgb(42, 66, 97), Color.rgb(97, 158, 100), (t - .35f) / .35f)
            else -> mix(Color.rgb(97, 158, 100), Color.rgb(241, 232, 155), (t - .7f) / .3f)
        }
    }
    private fun mix(a: Int, b: Int, t: Float) = Color.rgb((Color.red(a) + (Color.red(b) - Color.red(a)) * t).toInt(), (Color.green(a) + (Color.green(b) - Color.green(a)) * t).toInt(), (Color.blue(a) + (Color.blue(b) - Color.blue(a)) * t).toInt())
    private var bitmapFrames: List<HistoryFrame>? = null
    private var spectrumBitmap: Bitmap? = null
    private fun spectrogram(frames: List<HistoryFrame>): Bitmap? {
        if (frames.isEmpty()) return null
        if (frames === bitmapFrames) return spectrumBitmap
        val pixels = IntArray(frames.size * BANDS)
        for (x in frames.indices) for (band in 0 until BANDS) pixels[(BANDS - 1 - band) * frames.size + x] = colors[frames[x].spectrum[band].toInt() and 255]
        return Bitmap.createBitmap(pixels, frames.size, BANDS, Bitmap.Config.ARGB_8888).also { spectrumBitmap = it; bitmapFrames = frames }
    }
    @Synchronized fun draw(canvas: Canvas, width: Float, height: Float, view: View, state: StudioState, textSize: Float = 28f) {
        canvas.drawRect(0f, 0f, width, height, Paint().apply { color = background })
        val left = textSize * 3.2f; val right = width - textSize
        val top = textSize * 1.2f; val bottom = height - textSize * 2.4f
        val w = max(1f, right - left); val h = max(1f, bottom - top)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.textSize = textSize; color = muted; typeface = Typeface.MONOSPACE }
        fun line(x1: Float, y1: Float, x2: Float, y2: Float, color: Int = grid, stroke: Float = 1f) {
            paint.color = color; paint.strokeWidth = stroke; canvas.drawLine(x1, y1, x2, y2, paint)
        }
        fun text(value: String, x: Float, y: Float, align: Paint.Align = Paint.Align.LEFT, color: Int = muted) {
            paint.color = color; paint.textAlign = align; canvas.drawText(value, x, y, paint)
        }
        val range = state.range
        fun timeX(time: Double) = left + ((time - range.start) / range.span * w).toFloat()
        fun freqX(hz: Double) = left + (frequencyRatio(hz) * w).toFloat()
        fun freqY(hz: Double) = bottom - (frequencyRatio(hz) * h).toFloat()
        fun midiY(midi: Double) = bottom - ((midi - state.display.pitchLow) / 24 * h).toFloat()
        if (view == View.SPECTRUM) {
            for (db in listOf(-100, -80, -60, -40, -20)) {
                val y = bottom - (db + 100) / 85f * h
                line(left, y, right, y); text("$db", left - textSize * .5f, y + textSize / 3, Paint.Align.RIGHT)
            }
            for (hz in listOf(50, 100, 200, 500, 1000, 2000, 4000, 8000)) {
                val x = freqX(hz.toDouble()); line(x, top, x, bottom)
                text(if (hz >= 1000) "${hz / 1000}k" else "$hz", x, bottom + textSize * 1.7f, Paint.Align.CENTER)
            }
            text("dB", 0f, textSize); text("Hz", right, height, Paint.Align.RIGHT)
        } else {
            for (i in 0..3) {
                val t = range.start + range.span * i / 3
                val x = timeX(t); line(x, top, x, bottom)
                text(formatTime(t), x, bottom + textSize * 1.7f, when(i) { 0 -> Paint.Align.LEFT; 3 -> Paint.Align.RIGHT; else -> Paint.Align.CENTER })
            }
            when (view) {
                View.PITCH -> for (note in state.display.pitchLow..state.display.pitchLow + 24) {
                    val y = midiY(note.toDouble()); val c = if (note % 12 == 0) Color.rgb(76, 89, 69) else grid
                    line(left, y, right, y, c); text(noteName(note), left - textSize * .45f, y + textSize / 3, Paint.Align.RIGHT, if (note % 12 == 0) Color.rgb(222, 234, 213) else muted)
                }
                View.SPECTROGRAM -> for (hz in listOf(50, 100, 200, 500, 1000, 2000, 4000, 8000)) {
                    text(if (hz >= 1000) "${hz / 1000}k" else "$hz", left - textSize / 2, freqY(hz.toDouble()) + textSize / 3, Paint.Align.RIGHT)
                }
                View.WAVEFORM -> for (v in listOf(-1, 0, 1)) {
                    val y = top + (1 - v) / 2f * h; line(left, y, right, y); text("$v", left - textSize / 2, y + textSize / 3, Paint.Align.RIGHT)
                }
                else -> {}
            }
        }
        canvas.save(); canvas.clipRect(left, top, right, bottom)
        when (view) {
            View.PITCH -> {
                state.display.target?.takeIf { it in state.display.pitchLow..state.display.pitchLow + 24 }?.let {
                    paint.pathEffect = DashPathEffect(floatArrayOf(8f, 8f), 0f)
                    line(left, midiY(it.toDouble()), right, midiY(it.toDouble()), Color.rgb(221, 188, 136), 2f); paint.pathEffect = null
                }
                val path = Path(); var previous: HistoryFrame? = null
                val gap = max(.15, range.span / 650 * 2)
                for (f in state.frames) {
                    if (f.hz <= 0) { previous = null; continue }
                    val x = timeX(f.time); val y = midiY(69 + 12 * log2(f.hz / 440.0))
                    if (previous == null || f.breakBefore || f.time - previous.time > gap) path.moveTo(x, y) else path.lineTo(x, y)
                    previous = f
                }
                paint.color = accent; paint.style = Paint.Style.STROKE; paint.strokeWidth = max(2f, textSize / 9); canvas.drawPath(path, paint); paint.style = Paint.Style.FILL
            }
            View.WAVEFORM -> for (e in state.envelope) line(timeX(e.time), top + (1 - e.max) / 2 * h, timeX(e.time), top + (1 - e.min) / 2 * h, accent, 2f)
            View.SPECTROGRAM -> {
                val bitmap = spectrogram(state.frames)
                if (bitmap != null) for (i in state.frames.indices) {
                    val f = state.frames[i]
                    val next = state.frames.getOrNull(i + 1)?.time ?: (f.time + 1.0 / 30)
                    val end = min(next, f.time + if (state.frames.getOrNull(i + 1)?.gapBefore == true) 1.0 / 30 else max(.075, range.span / 650 * 1.2))
                    canvas.drawBitmap(bitmap, Rect(i, 0, i + 1, BANDS), RectF(timeX(f.time), top, max(timeX(f.time) + 1, timeX(end)), bottom), null)
                }
            }
            View.SPECTRUM -> state.frame?.let { frame ->
                val path = Path(); var first = true
                for (i in 1 until frame.spectrum.size) {
                    val hz = i.toDouble() * SAMPLE_RATE / FFT_SIZE; if (hz < 50 || hz > 8000) continue
                    val x = freqX(hz); val y = bottom - (frame.spectrum[i] + 100).coerceIn(0f, 85f) / 85 * h
                    if (first) { path.moveTo(x, y); first = false } else path.lineTo(x, y)
                }
                frame.pitch?.let { pitch ->
                    paint.pathEffect = DashPathEffect(floatArrayOf(5f, 7f), 0f)
                    for (i in 1..min(20, (8000 / pitch.hz).toInt())) line(freqX(pitch.hz * i), top, freqX(pitch.hz * i), bottom, Color.rgb(66, 80, 55))
                    paint.pathEffect = null
                }
                paint.color = accent; paint.strokeWidth = 2f; paint.style = Paint.Style.STROKE; canvas.drawPath(path, paint); paint.style = Paint.Style.FILL
                for (peak in spectralPeaks(frame.spectrum)) {
                    val x = freqX(peak.hz); val y = bottom - (peak.db + 100) / 85 * h
                    paint.color = accent; canvas.drawCircle(x, y, 4f, paint); text("${peak.hz.roundToInt()}", x, y - textSize / 2, Paint.Align.CENTER)
                }
            }
        }
        if (view != View.SPECTRUM) state.cursor?.let { line(timeX(it), top, timeX(it), bottom, Color.rgb(234, 193, 140), 2f) }
        canvas.restore()
    }
    fun colorScale(canvas: Canvas, x: Float, y: Float, width: Float, textSize: Float) {
        val p = Paint().apply { this.textSize = textSize; typeface = Typeface.MONOSPACE }
        for (i in 0..255) { p.color = colors[i]; canvas.drawRect(x + i * width / 256, y, x + (i + 1) * width / 256, y + textSize * .5f, p) }
        p.color = muted; canvas.drawText("−100 dB", x, y + textSize * 1.8f, p)
        p.textAlign = Paint.Align.RIGHT; canvas.drawText("−15 dB", x + width, y + textSize * 1.8f, p)
    }
    fun detail(canvas: Canvas, width: Float, height: Float, state: StudioState, textSize: Float) {
        val samples = state.frame?.waveform ?: return
        val count = min(samples.size, state.display.milliseconds * SAMPLE_RATE / 1000)
        var start = 0
        for (i in 1 until samples.size - count) if (samples[i - 1] <= 0 && samples[i] > 0) { start = i; break }
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = grid; strokeWidth = 1f }
        canvas.drawLine(0f, height / 2, width, height / 2, p)
        val path = Path()
        for (i in 0 until count) {
            val x = i.toFloat() / max(1, count - 1) * width
            val y = height / 2 - samples[start + i] * state.display.gain * height * .4f
            if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        canvas.save(); canvas.clipRect(0f, 0f, width, height)
        p.color = accent; p.style = Paint.Style.STROKE; p.strokeWidth = 2f; canvas.drawPath(path, p); canvas.restore()
        p.style = Paint.Style.FILL; p.color = muted; p.textSize = textSize; canvas.drawText("${state.display.milliseconds} ms · ×${state.display.gain}", 4f, height - 4f, p)
    }
    fun export(context: Context, uri: Uri, session: SessionHandle, state: StudioState, range: TimeRange) {
        val snapshot = state.copy(range = range, frames = session.frames(range, 1500), envelope = session.envelopeIndex.visible(range, 1500), cursor = null)
        val analysis = if (state.view == View.PITCH) View.entries.first { it.name.lowercase() == state.display.view } else state.view
        val bitmap = Bitmap.createBitmap(1600, 1240, Bitmap.Config.ARGB_8888)
        try {
            val canvas = Canvas(bitmap); canvas.drawColor(background)
            val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(230, 235, 223); textSize = 24f }
            canvas.drawText("${session.meta.name.take(60)} · ${formatTime(range.start)} — ${formatTime(range.end)}", 54f, 38f, p)
            p.color = muted; p.textSize = 18f; canvas.drawText("48 kHz · ${noteName(state.display.pitchLow)} — ${noteName(state.display.pitchLow + 24)} · 音高 / ${analysis.name.lowercase()}", 54f, 72f, p)
            canvas.save(); canvas.translate(0f, 90f); draw(canvas, 1600f, 560f, View.PITCH, snapshot, 18f); canvas.restore()
            canvas.save(); canvas.translate(0f, 700f); draw(canvas, 1600f, 460f, analysis, snapshot, 18f); canvas.restore()
            if (analysis == View.SPECTROGRAM) colorScale(canvas, 60f, 1170f, 500f, 18f)
            canvas.drawText(if (analysis == View.SPECTRUM) "瞬时频谱 · 横轴 Hz · 纵轴 dB" else "时间 mm:ss · 空缺表示没有分析数据", 690f, 1205f, p)
            context.contentResolver.openOutputStream(uri, "wt")!!.use { require(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)); it.flush() }
        } finally { bitmap.recycle() }
    }
}
