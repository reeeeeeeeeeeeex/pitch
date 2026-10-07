package app.pitchstudio.core

import com.google.gson.GsonBuilder
import java.io.*
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.time.Instant
import java.util.UUID
import kotlin.math.*

internal fun little(size: Int) = ByteBuffer.allocate(size).order(ByteOrder.LITTLE_ENDIAN)
internal val gson = GsonBuilder().serializeNulls().create()
internal fun atomicText(file: File, text: String) {
    val tmp = File(file.parentFile, file.name + ".tmp")
    FileOutputStream(tmp).use { it.write(text.toByteArray(Charsets.UTF_8)); it.fd.sync() }
    Files.move(tmp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
}
fun wavHeader(samples: Long): ByteArray = little(44).apply {
    put("RIFF".toByteArray()); putInt((36 + samples * 2).toInt()); put("WAVEfmt ".toByteArray())
    putInt(16); putShort(1); putShort(1); putInt(SAMPLE_RATE); putInt(SAMPLE_RATE * 2)
    putShort(2); putShort(16); put("data".toByteArray()); putInt((samples * 2).toInt())
}.array()

/** Multi-resolution extrema. A whole-session draw reads at most ~2 * pixel width bins. */
class EnvelopeIndex {
    private val levels = mutableListOf<MutableList<Envelope>>(mutableListOf())
    @Synchronized fun add(e: Envelope) {
        var value = e; var level = 0
        while (true) {
            if (levels.size <= level) levels.add(mutableListOf())
            val list = levels[level]; list.add(value)
            if (list.size % 2 != 0) break
            val a = list[list.size - 2]; val b = list.last()
            value = Envelope(a.time, min(a.min, b.min), max(a.max, b.max)); level++
        }
    }
    @Synchronized fun visible(range: TimeRange, pixels: Int): List<Envelope> {
        val desired = max(1, ceil(range.span * 100 / max(1, pixels)).toInt())
        val level = floor(log2(desired.toDouble())).toInt().coerceIn(0, levels.lastIndex)
        val list = levels[level]
        fun bound(time: Double): Int {
            var a = 0; var b = list.size
            while (a < b) { val m = (a + b) / 2; if (list[m].time < time) a = m + 1 else b = m }
            return a
        }
        val result = list.subList(max(0, bound(range.start) - 1), min(list.size, bound(range.end) + 1)).toMutableList()
        // Coarse levels may not yet contain the last incomplete group.
        val tailStart = result.lastOrNull()?.time ?: range.start
        val raw = levels[0]
        var lo = max(0, raw.size - (1 shl level))
        var tail: Envelope? = null
        while (lo < raw.size) {
            val e = raw[lo++]
            if (e.time >= tailStart && e.time in range.start..range.end)
                tail = if (tail == null) e else Envelope(tail.time, min(tail.min, e.min), max(tail.max, e.max))
        }
        tail?.let { result.add(it) }
        return result
    }
}

class SessionRepository(val root: File) {
    init {
        root.mkdirs()
        root.listFiles().orEmpty().filter { it.isDirectory && it.name.matches(Regex("[a-f0-9-]{36}")) }.forEach { dir ->
            runCatching {
                val meta = gson.fromJson(File(dir, "meta.json").readText(), SessionMeta::class.java)
                if (!meta.complete) open(dir.name).use { it.recover() }
            }
        }
    }
    fun create(recorded: Boolean, settings: InputSettings): SessionHandle {
        val id = UUID.randomUUID().toString()
        val now = Instant.now().toString()
        val meta = SessionMeta(id, now.substring(0, 19).replace('T', ' '), now, recorded, settings = settings)
        val dir = File(root, id); check(dir.mkdir())
        return SessionHandle(dir, meta, true).also { it.checkpoint() }
    }
    fun list(): List<SessionMeta> = root.listFiles().orEmpty().mapNotNull { dir ->
        if (!dir.isDirectory || !dir.name.matches(Regex("[a-f0-9-]{36}"))) return@mapNotNull null
        runCatching {
            val meta = gson.fromJson(File(dir, "meta.json").readText(), SessionMeta::class.java)
            if (meta.id != dir.name) return@runCatching null
            meta.takeIf { it.complete }
        }.getOrNull()
    }.filter { it.samples > 0 }.sortedByDescending { it.createdAt }
    fun open(id: String): SessionHandle {
        require(id.matches(Regex("[a-f0-9-]{36}")))
        val dir = File(root, id)
        val meta = gson.fromJson(File(dir, "meta.json").readText(), SessionMeta::class.java)
        require(meta.id == id)
        return SessionHandle(dir, meta, false)
    }
    fun rename(id: String, name: String) { require(name.isNotBlank() && name.length <= 200); open(id).use { it.updateMeta(it.meta.copy(name = name.trim())); it.checkpoint() } }
    fun delete(id: String) {
        require(id.matches(Regex("[a-f0-9-]{36}")))
        val directory = File(root, id).canonicalFile
        require(directory.parentFile == root.canonicalFile)
        check(directory.deleteRecursively())
    }
}

class SessionHandle(val directory: File, initial: SessionMeta, private var writable: Boolean) : Closeable, CaptureSink {
    @Volatile var meta = initial; private set
    @Volatile var latest: AnalysisFrame? = null; private set
    override val samples: Long get() = meta.samples
    override fun hasSpace() = directory.usableSpace > 8L * 1024 * 1024
    private val history = RandomAccessFile(File(directory, "history.bin"), "rw")
    private val envelopes = RandomAccessFile(File(directory, "envelopes.bin"), "rw")
    val wavFile = File(directory, "recording.wav")
    private val wav = if (meta.recorded) RandomAccessFile(wavFile, "rw") else null
    private val timestamps = ArrayList<Double>()
    private val voicedBreaks = ArrayList<Int>()
    private val gaps = ArrayList<Int>()
    private var lastHz = 0f
    val envelopeIndex = EnvelopeIndex()
    private var envelopeMin = 1f; private var envelopeMax = -1f; private var envelopeCount = 0
    private var closed = false
    init {
        if (writable) { wav?.write(wavHeader(0)) }
        else {
            if (!meta.complete) trimToCheckpoint()
            history.seek(0)
            val bytes = ByteArray(FRAME_BYTES)
            while (history.filePointer + FRAME_BYTES <= history.length()) {
                history.readFully(bytes); val b = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
                indexFrame(b.double, b.float)
            }
            envelopes.seek(0)
            val e = ByteArray(16)
            while (envelopes.filePointer + 16 <= envelopes.length()) {
                envelopes.readFully(e); val b = ByteBuffer.wrap(e).order(ByteOrder.LITTLE_ENDIAN)
                envelopeIndex.add(Envelope(b.double, b.float, b.float))
            }
            latest = readSnapshot()
        }
    }
    @Synchronized fun updateMeta(value: SessionMeta) { meta = value }
    @Synchronized fun updateDisplay(value: DisplaySettings) { meta = meta.copy(display = value) }
    @Synchronized override fun appendPcm(samples: ShortArray, count: Int): Int {
        check(writable && !closed)
        val accepted = min(count.toLong(), MAX_SAMPLES - meta.samples).toInt()
        if (accepted <= 0) return 0
        if (wav != null) {
            val bytes = little(accepted * 2)
            for (i in 0 until accepted) bytes.putShort(samples[i])
            wav.seek(44 + meta.samples * 2); wav.write(bytes.array())
        }
        val base = meta.samples
        for (i in 0 until accepted) {
            val v = samples[i] / 32768f
            envelopeMin = min(envelopeMin, v); envelopeMax = max(envelopeMax, v); envelopeCount++
            if (envelopeCount == 480) writeEnvelope((base + i + 1 - envelopeCount).toDouble() / SAMPLE_RATE)
        }
        meta = meta.copy(samples = base + accepted)
        return accepted
    }
    private fun writeEnvelope(time: Double) {
        val e = Envelope(time, envelopeMin, envelopeMax)
        envelopes.seek(envelopes.length())
        envelopes.write(little(16).putDouble(e.time).putFloat(e.min).putFloat(e.max).array())
        envelopeIndex.add(e)
        envelopeCount = 0; envelopeMin = 1f; envelopeMax = -1f
    }
    @Synchronized override fun appendFrame(frame: AnalysisFrame) {
        if (!writable || closed || frame.time > meta.duration + 1e-6 || frame.time <= (timestamps.lastOrNull() ?: -1.0)) return
        val bytes = little(FRAME_BYTES).putDouble(frame.time).putFloat(frame.pitch?.hz?.toFloat() ?: 0f)
            .putFloat(frame.pitch?.clarity?.toFloat() ?: 0f).putFloat(frame.rmsDb.coerceAtLeast(-160f)).putFloat(frame.peak)
            .put(quantizeSpectrum(frame.spectrum)).array()
        history.seek(history.length()); history.write(bytes)
        indexFrame(frame.time, frame.pitch?.hz?.toFloat() ?: 0f); latest = frame
    }
    private fun indexFrame(time: Double, hz: Float) {
        val gap = timestamps.lastOrNull()?.let { time - it > .15 } ?: false
        if (gap) gaps.add(timestamps.size)
        if (hz > 0 && (gap || lastHz <= 0)) voicedBreaks.add(timestamps.size)
        timestamps.add(time); lastHz = hz
    }
    private fun crosses(indices: List<Int>, after: Int, through: Int): Boolean {
        val found = indices.binarySearch(after + 1)
        val index = if (found < 0) -found - 1 else found
        return index < indices.size && indices[index] <= through
    }
    @Synchronized fun frames(range: TimeRange, maxPoints: Int = 2000): List<HistoryFrame> {
        val begin = max(0, lowerBound(range.start) - 1)
        val end = min(timestamps.size, lowerBound(min(range.end, meta.duration)) + 1)
        val step = max(1, ceil((end - begin).toDouble() / max(1, maxPoints)).toInt())
        val bytes = ByteArray(FRAME_BYTES)
        val result = ArrayList<HistoryFrame>()
        var previous = begin - 1
        for (i in begin until end step step) {
            history.seek(i.toLong() * FRAME_BYTES); history.readFully(bytes)
            val b = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
            result.add(HistoryFrame(b.double, b.float, b.float, b.float, b.float, ByteArray(BANDS).also { b.get(it) },
                crosses(voicedBreaks, previous, i), crosses(gaps, previous, i)))
            previous = i
        }
        return result
    }
    @Synchronized fun near(time: Double): HistoryFrame? {
        val list = frames(TimeRange(max(0.0, time - .08), time + .08), 8)
        return list.minByOrNull { abs(it.time - time) }?.takeIf { abs(it.time - time) <= .08 }
    }
    private fun lowerBound(time: Double): Int {
        var a = 0; var b = timestamps.size
        while (a < b) { val m = (a + b) / 2; if (timestamps[m] < time) a = m + 1 else b = m }
        return a
    }
    @Synchronized override fun checkpoint() {
        check(!closed)
        wav?.let { it.seek(0); it.write(wavHeader(meta.samples)); it.fd.sync() }
        history.fd.sync(); envelopes.fd.sync()
        writeSnapshot()
        meta = meta.copy(historyBytes = history.length(), envelopeBytes = envelopes.length())
        atomicText(File(directory, "meta.json"), gson.toJson(meta))
    }
    @Synchronized override fun finish(reason: String, interrupted: Boolean) {
        if (envelopeCount > 0) writeEnvelope((meta.samples - envelopeCount).toDouble() / SAMPLE_RATE)
        meta = meta.copy(complete = true, reason = reason, interrupted = interrupted)
        checkpoint(); writable = false
    }
    private fun trimToCheckpoint() {
        val samples = if (wav != null) min(meta.samples, max(0, (wav.length() - 44) / 2)) else meta.samples
        wav?.setLength(44 + samples * 2)
        history.setLength(min(meta.historyBytes, history.length()) / FRAME_BYTES * FRAME_BYTES)
        envelopes.setLength(min(meta.envelopeBytes, envelopes.length()) / 16 * 16)
        meta = meta.copy(samples = samples)
    }
    @Synchronized fun recover() { if (!meta.complete) { trimToCheckpoint(); finish("上次采集意外中断，已恢复落盘数据", true) } }
    private fun writeSnapshot() {
        val f = latest ?: return
        val b = little((PITCH_SIZE + FFT_SIZE / 2) * 4)
        f.waveform.forEach { b.putFloat(it) }; f.spectrum.forEach { b.putFloat(it) }
        FileOutputStream(File(directory, "snapshot.bin")).use { it.write(b.array()); it.fd.sync() }
        atomicText(File(directory, "snapshot.json"), gson.toJson(SnapshotMeta(f.time, f.pitch?.hz ?: 0.0, f.pitch?.clarity ?: 0.0, f.rmsDb, f.peak)))
    }
    private fun readSnapshot(): AnalysisFrame? = runCatching {
        val m = gson.fromJson(File(directory, "snapshot.json").readText(), SnapshotMeta::class.java)
        if (m.time > meta.duration + 1e-6) return@runCatching null
        val b = ByteBuffer.wrap(File(directory, "snapshot.bin").readBytes()).order(ByteOrder.LITTLE_ENDIAN)
        AnalysisFrame(m.time, if (m.hz > 0) Pitch(m.hz, m.clarity) else null, m.rmsDb, m.peak,
            FloatArray(PITCH_SIZE) { b.float }, FloatArray(FFT_SIZE / 2) { b.float })
    }.getOrNull()
    @Synchronized override fun close() { if (!closed) { history.close(); envelopes.close(); wav?.close(); closed = true } }
}
data class SnapshotMeta(val time: Double, val hz: Double, val clarity: Double, val rmsDb: Float, val peak: Float)
