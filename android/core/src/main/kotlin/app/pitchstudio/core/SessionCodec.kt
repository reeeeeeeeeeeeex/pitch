package app.pitchstudio.core

import com.google.gson.*
import java.io.*
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.time.Instant
import java.util.UUID
import kotlin.math.abs

/** Streaming codec for the web application's PITCHS01 JSON + binary container. */
object SessionCodec {
    fun export(session: SessionHandle, output: OutputStream) {
        session.checkpoint()
        val m = session.meta
        require(m.samples > 0 && m.complete) { "请先结束采集" }
        val latest = session.latest
        val files = listOf(File(session.directory, "history.bin"), File(session.directory, "envelopes.bin"),
            session.wavFile.takeIf { m.recorded }, File(session.directory, "snapshot.bin").takeIf { latest != null })
        val lengths = files.map { it?.length() ?: 0 }
        val manifest = JsonObject().apply {
            addProperty("version", 1); addProperty("name", m.name); addProperty("createdAt", m.createdAt)
            addProperty("duration", m.duration); addProperty("sampleRate", SAMPLE_RATE); addProperty("recorded", m.recorded)
            add("settings", gson.toJsonTree(m.settings)); add("display", gson.toJsonTree(m.display))
            add("lengths", gson.toJsonTree(lengths))
            add("latest", if (latest == null) JsonNull.INSTANCE else gson.toJsonTree(SnapshotMeta(latest.time, latest.pitch?.hz ?: 0.0,
                latest.pitch?.clarity ?: 0.0, latest.rmsDb.coerceAtLeast(-160f), latest.peak)))
        }.toString().toByteArray(Charsets.UTF_8)
        require(manifest.size <= 65536 && lengths.sum() + manifest.size + 12 <= MAX_SESSION_BYTES)
        output.write("PITCHS01".toByteArray()); output.write(little(4).putInt(manifest.size).array()); output.write(manifest)
        files.forEach { file -> file?.inputStream()?.use { it.copyTo(output, 65536) } }
        output.flush()
    }

    fun import(repository: SessionRepository, input: InputStream): SessionHandle {
        val stream = DataInputStream(BufferedInputStream(input, 65536))
        val header = ByteArray(12); stream.readFully(header)
        require(String(header, 0, 8, Charsets.US_ASCII) == "PITCHS01") { "不是支持的 .pitchsession 文件" }
        val manifestSize = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN).getInt(8)
        require(manifestSize in 1..65536) { "会话清单长度不合法" }
        val json = ByteArray(manifestSize); stream.readFully(json)
        val text = Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(json)).toString()
        val m = JsonParser.parseString(text).obj()
        require(m.num("version", 1.0, 1.0) == 1.0) { "不支持此会话版本" }
        require(m.num("sampleRate", SAMPLE_RATE.toDouble(), SAMPLE_RATE.toDouble()) == SAMPLE_RATE.toDouble())
        val duration = m.num("duration", 1.0 / SAMPLE_RATE, MAX_SECONDS.toDouble())
        val samples = kotlin.math.round(duration * SAMPLE_RATE).toLong()
        require(abs(samples.toDouble() / SAMPLE_RATE - duration) <= 1.0 / SAMPLE_RATE)
        val recorded = m.bool("recorded")
        val name = m.str("name").also { require(it.length <= 200) }.replace(Regex("[\\\\/:*?\"<>|]"), "-")
        val createdAt = m.str("createdAt").also { Instant.parse(it) }
        val lengthsElement = m.get("lengths")
        require(lengthsElement?.isJsonArray == true && lengthsElement.asJsonArray.size() == 4)
        val lengths = lengthsElement.asJsonArray.map { element ->
            val n = number(element, 0.0, MAX_SESSION_BYTES.toDouble()); require(n % 1 == 0.0); n.toLong()
        }
        require(lengths.sum() + manifestSize + 12 <= MAX_SESSION_BYTES) { "会话超过 256 MiB" }
        require(lengths[0] % FRAME_BYTES == 0L && lengths[0] <= 60000L * FRAME_BYTES)
        require(lengths[1] % 16 == 0L && lengths[1] <= 180001L * 16)
        require(lengths[3] == 0L || lengths[3] == (PITCH_SIZE + FFT_SIZE / 2) * 4L)
        if (recorded) require(lengths[2] == 44 + samples * 2) { "WAV 时长或长度不匹配" }
        else require(lengths[2] == 0L)
        val d = m.get("display").obj()
        val display = parseDisplay(d)
        val settings = m.get("settings")?.takeUnless { it.isJsonNull }?.obj()?.let { s ->
            InputSettings(sampleRate = s.get("sampleRate")?.let { number(it, 8000.0, 384000.0).toInt() } ?: SAMPLE_RATE,
                source = s.get("source")?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString ?: "导入会话",
                echoCancellation = s.optionalBool("echoCancellation"), noiseSuppression = s.optionalBool("noiseSuppression"), autoGainControl = s.optionalBool("autoGainControl"))
        } ?: InputSettings()
        val snapshot = if (lengths[3] > 0) m.get("latest").obj().let { f ->
            SnapshotMeta(f.num("time", 0.0, duration + 1e-6), f.num("hz", 0.0, 24000.0),
                f.num("clarity", 0.0, 1.0), f.num("rmsDb", -160.0, 30.0).toFloat(), f.num("peak", 0.0, 16.0).toFloat())
        } else { require(m.get("latest")?.isJsonNull == true); null }
        val id = UUID.randomUUID().toString()
        val directory = File(repository.root, id); check(directory.mkdir())
        try {
            val names = listOf("history.bin", "envelopes.bin", "recording.wav", "snapshot.bin")
            for (i in 0..3) {
                FileOutputStream(File(directory, names[i])).use { output ->
                    var remaining = lengths[i]; val chunk = ByteArray(65536)
                    while (remaining > 0) { val count = minOf(chunk.size.toLong(), remaining).toInt(); stream.readFully(chunk, 0, count); output.write(chunk, 0, count); remaining -= count }
                    output.fd.sync()
                }
            }
            require(stream.read() == -1) { "会话数据块长度不匹配" }
            validateHistory(File(directory, "history.bin"), duration)
            validateEnvelopes(File(directory, "envelopes.bin"), duration)
            if (recorded) FileInputStream(File(directory, "recording.wav")).use { wav ->
                val h = ByteArray(44); DataInputStream(wav).readFully(h)
                require(h.contentEquals(wavHeader(samples))) { "不是 48 kHz 单声道 PCM WAV" }
            }
            if (snapshot != null) {
                val data = ByteBuffer.wrap(File(directory, "snapshot.bin").readBytes()).order(ByteOrder.LITTLE_ENDIAN)
                repeat(PITCH_SIZE) { val v = data.float; require(v.isFinite() && abs(v) <= 16) }
                repeat(FFT_SIZE / 2) { val v = data.float; require(v == Float.NEGATIVE_INFINITY || v.isFinite() && v in -1000f..100f) }
                atomicText(File(directory, "snapshot.json"), gson.toJson(snapshot))
            }
            val meta = SessionMeta(id, name, createdAt, recorded, samples, lengths[0], lengths[1], complete = true, settings = settings, display = display)
            atomicText(File(directory, "meta.json"), gson.toJson(meta))
            return repository.open(id)
        } catch (error: Exception) { directory.deleteRecursively(); throw IllegalArgumentException("会话导入失败：${error.message}", error) }
    }
    private fun validateHistory(file: File, duration: Double) {
        DataInputStream(file.inputStream()).use { input ->
            val bytes = ByteArray(FRAME_BYTES); var previous = -1.0
            repeat((file.length() / FRAME_BYTES).toInt()) {
                input.readFully(bytes); val b = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
                val time = b.double; val hz = b.float; val clarity = b.float; val rms = b.float; val peak = b.float
                require(time.isFinite() && time > previous && time >= 0 && time <= duration + 1e-6)
                require(hz.isFinite() && hz in 0f..24000f && clarity.isFinite() && clarity in 0f..1f)
                require(rms.isFinite() && rms in -160f..30f && peak.isFinite() && peak in 0f..16f)
                previous = time
            }
        }
    }
    private fun validateEnvelopes(file: File, duration: Double) {
        DataInputStream(file.inputStream()).use { input ->
            val bytes = ByteArray(16); var previous = -1.0
            repeat((file.length() / 16).toInt()) {
                input.readFully(bytes); val b = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
                val time = b.double; val min = b.float; val max = b.float
                require(time.isFinite() && time > previous && time >= 0 && time <= duration + 1e-6)
                require(min.isFinite() && max.isFinite() && min >= -16 && max <= 16 && min <= max)
                previous = time
            }
        }
    }
    private fun parseDisplay(d: JsonObject): DisplaySettings {
        val target = d.get("target").let { if (it == null || it.isJsonNull) null else number(it, 21.0, 108.0).toInt() }
        val low = d.get("pitchLow")?.let { number(it, 21.0, 84.0).also { n -> require(n % 1 == 0.0) }.toInt() } ?: 48
        fun choice(key: String, choices: List<Int>, fallback: Int) = d.get(key)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isNumber }?.asInt?.takeIf { it in choices } ?: fallback
        fun view(key: String, choices: List<String>, fallback: String) = d.get(key)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString?.takeIf { it in choices } ?: fallback
        return DisplaySettings(view("view", listOf("spectrum", "spectrogram", "waveform"), "spectrogram"),
            view("mobileView", listOf("pitch", "spectrum", "spectrogram", "waveform"), "pitch"),
            choice("windowSeconds", listOf(0, 10, 30, 60, 300), 30), target,
            choice("milliseconds", listOf(5, 10, 20, 50), 20), choice("gain", listOf(1, 2, 4, 8), 1), low,
            d.get("pitchFollowing")?.let { d.bool("pitchFollowing") } ?: true)
    }
    private fun JsonElement?.obj(): JsonObject { require(this?.isJsonObject == true) { "会话清单不合法" }; return this.asJsonObject }
    private fun number(e: JsonElement?, low: Double, high: Double): Double {
        require(e?.isJsonPrimitive == true && e.asJsonPrimitive.isNumber) { "会话数值不合法" }
        return e.asDouble.also { require(it.isFinite() && it in low..high) { "会话数值越界" } }
    }
    private fun JsonObject.num(key: String, low: Double, high: Double) = number(get(key), low, high)
    private fun JsonObject.bool(key: String): Boolean { val e = get(key); require(e?.isJsonPrimitive == true && e.asJsonPrimitive.isBoolean); return e.asBoolean }
    private fun JsonObject.optionalBool(key: String) = get(key)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isBoolean }?.asBoolean
    private fun JsonObject.str(key: String): String { val e = get(key); require(e?.isJsonPrimitive == true && e.asJsonPrimitive.isString); return e.asString }
}
