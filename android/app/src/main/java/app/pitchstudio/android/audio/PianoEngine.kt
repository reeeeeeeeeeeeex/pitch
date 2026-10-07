package app.pitchstudio.android.audio

import android.content.Context
import android.media.*
import java.io.Closeable
import java.nio.ByteOrder
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.*

/** Decodes the bundled Salamander samples on demand and mixes at most eight voices. */
class PianoEngine(private val context: Context) : Closeable {
    private data class Sample(val pcm: FloatArray, val rate: Int)
    private data class Voice(val sample: Sample, val step: Double, var position: Double = 0.0, var age: Int = 0)
    private val executor = Executors.newSingleThreadExecutor()
    private val request = AtomicLong()
    private val cache = object : LinkedHashMap<Int, Sample>(8, .75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Int, Sample>?) = size > 8
    }
    private val voices = mutableListOf<Voice>()
    private val lock = Object()
    @Volatile private var closed = false
    @Volatile var samplesPlayed = 0L; private set
    @Volatile var decodedSamples = 0; private set
    @Volatile var lastDecodedPeak = 0f; private set
    @Volatile private var playbackError: (String) -> Unit = {}
    private var track: AudioTrack? = null
    private var mixer: Thread? = null
    fun play(midi: Int, onError: (String) -> Unit = {}) {
        require(midi in 21..108)
        playbackError = onError
        val token = request.incrementAndGet()
        executor.execute {
            try {
                val root = (21 + ((midi - 21) / 3.0).roundToInt() * 3).coerceIn(21, 108)
                val sample = cache[root] ?: decode(root).also { cache[root] = it; decodedSamples++ }
                if (closed || token != request.get()) return@execute
                synchronized(lock) {
                    if (voices.size == 8) voices.removeAt(0)
                    voices.add(Voice(sample, sample.rate / 48000.0 * 2.0.pow((midi - root) / 12.0)))
                    if (mixer == null) startMixer()
                    lock.notifyAll()
                }
            } catch (e: Exception) { if (!closed && token == request.get()) onError("钢琴加载失败：${e.message}") }
        }
    }
    private fun decode(midi: Int): Sample {
        val names = arrayOf("C", "Cs", "D", "Ds", "E", "F", "Fs", "G", "Gs", "A", "As", "B")
        val path = "piano/salamander/${names[midi % 12]}${midi / 12 - 1}.mp3"
        val extractor = MediaExtractor(); var codec: MediaCodec? = null
        try {
            context.assets.openFd(path).use { extractor.setDataSource(it.fileDescriptor, it.startOffset, it.length) }
            extractor.selectTrack(0)
            val format = extractor.getTrackFormat(0); var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT); var encoding = AudioFormat.ENCODING_PCM_16BIT
            codec = MediaCodec.createDecoderByType(requireNotNull(format.getString(MediaFormat.KEY_MIME)))
            codec.configure(format, null, null, 0); codec.start()
            val values = FloatArray(192000 * 2); var used = 0; var inputDone = false; var outputDone = false
            val info = MediaCodec.BufferInfo()
            val deadline = System.nanoTime() + 10_000_000_000L
            while (!outputDone && !closed && System.nanoTime() < deadline) {
                if (!inputDone) {
                    val index = codec.dequeueInputBuffer(10000)
                    if (index >= 0) {
                        val input = codec.getInputBuffer(index)!!
                        val size = extractor.readSampleData(input, 0)
                        if (size < 0) { codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true }
                        else { codec.queueInputBuffer(index, 0, size, extractor.sampleTime, 0); extractor.advance() }
                    }
                }
                val index = codec.dequeueOutputBuffer(info, 10000)
                if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    val output = codec.outputFormat; rate = output.getInteger(MediaFormat.KEY_SAMPLE_RATE); channels = output.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    encoding = if (output.containsKey(MediaFormat.KEY_PCM_ENCODING)) output.getInteger(MediaFormat.KEY_PCM_ENCODING) else AudioFormat.ENCODING_PCM_16BIT
                } else if (index >= 0) {
                    val buffer = codec.getOutputBuffer(index)!!.order(ByteOrder.LITTLE_ENDIAN)
                    buffer.position(info.offset); buffer.limit(info.offset + info.size)
                    val size = if (encoding == AudioFormat.ENCODING_PCM_FLOAT) 4 else 2
                    while (buffer.remaining() >= channels * size && used < min(values.size, rate * 4)) {
                        var value = 0f
                        repeat(channels) { value += if (size == 4) buffer.float else buffer.short / 32768f }
                        values[used++] = value / channels
                    }
                    outputDone = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0 || used >= rate * 4
                    codec.releaseOutputBuffer(index, false)
                }
            }
            check(used > 0 && outputDone) { "采样解码超时或为空" }
            val pcm = values.copyOf(used)
            lastDecodedPeak = pcm.maxOf { abs(it) }
            return Sample(pcm, rate)
        } finally { runCatching { codec?.stop() }; codec?.release(); extractor.release() }
    }
    private fun startMixer() {
        mixer = Thread({
            try {
                val audio = AudioTrack.Builder().setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                    .setAudioFormat(AudioFormat.Builder().setSampleRate(48000).setEncoding(AudioFormat.ENCODING_PCM_FLOAT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                    .setBufferSizeInBytes(max(4096, AudioTrack.getMinBufferSize(48000, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT)))
                    .setTransferMode(AudioTrack.MODE_STREAM).build()
                track = audio; audio.play()
                val output = FloatArray(480)
                while (!closed) {
                    synchronized(lock) {
                        while (voices.isEmpty() && !closed) lock.wait()
                        output.fill(0f)
                        val iterator = voices.iterator()
                        while (iterator.hasNext()) {
                            val voice = iterator.next()
                            for (i in output.indices) {
                                val pos = voice.position.toInt()
                                if (pos >= voice.sample.pcm.size - 1 || voice.age >= 192000) break
                                val fraction = (voice.position - pos).toFloat()
                                val value = voice.sample.pcm[pos] * (1 - fraction) + voice.sample.pcm[pos + 1] * fraction
                                val envelope = min(1f, voice.age / 240f) * min(1f, min((192000 - voice.age) / 12000f, (voice.sample.pcm.size - 1 - pos) / (voice.sample.rate * .25f)))
                                output[i] += value * envelope * .55f
                                voice.position += voice.step; voice.age++
                            }
                            if (voice.position >= voice.sample.pcm.size - 1 || voice.age >= 192000) iterator.remove()
                        }
                    }
                    if (closed) break
                    for (i in output.indices) output[i] = output[i].coerceIn(-.95f, .95f)
                    var offset = 0
                    while (offset < output.size && !closed) {
                        val count = audio.write(output, offset, output.size - offset, AudioTrack.WRITE_BLOCKING)
                        if (count <= 0) error("钢琴输出不可用")
                        offset += count; samplesPlayed += count
                    }
                }
            } catch (error: Exception) {
                if (!closed) playbackError("钢琴播放失败：${error.message}")
                synchronized(lock) { voices.clear() }
            } finally {
                runCatching { track?.stop() }; track?.release()
                synchronized(lock) { track = null; mixer = null }
            }
        }, "pitch-piano").apply { start() }
    }
    fun stopAll() { request.incrementAndGet(); synchronized(lock) { voices.clear(); track?.pause(); track?.flush(); track?.play() } }
    override fun close() {
        closed = true; request.incrementAndGet(); synchronized(lock) { voices.clear(); lock.notifyAll() }
        executor.shutdownNow()
    }
}
