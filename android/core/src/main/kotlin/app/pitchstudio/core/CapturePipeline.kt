package app.pitchstudio.core

import java.io.Closeable
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

interface PcmSource : Closeable {
    val settings: InputSettings
    fun start()
    fun read(buffer: ShortArray): Int
    fun stop()
}
interface CaptureSink {
    val samples: Long
    fun appendPcm(samples: ShortArray, count: Int = samples.size): Int
    fun appendFrame(frame: AnalysisFrame)
    fun checkpoint()
    fun finish(reason: String = "", interrupted: Boolean = false)
    fun hasSpace(): Boolean = true
}

/** Lossless capture/write queue; analysis is conflated and can never backpressure capture. */
class CapturePipeline(
    private val source: PcmSource, private val sink: CaptureSink,
    private val onFrame: (AnalysisFrame) -> Unit,
    private val onFinished: (String) -> Unit,
) {
    private val running = AtomicBoolean(false)
    private val captured = AtomicBoolean(false)
    private val written = AtomicBoolean(false)
    private val reason = AtomicReference("")
    private val queue = ArrayBlockingQueue<ShortArray>(64)
    private val pending = AtomicReference<Pair<FloatArray, Double>?>(null)
    private lateinit var captureThread: Thread
    private lateinit var writerThread: Thread
    private lateinit var analysisThread: Thread

    fun start(onStarted: () -> Unit = {}) {
        check(running.compareAndSet(false, true))
        try { source.start(); onStarted() } catch (error: Exception) { running.set(false); source.close(); throw error }
        analysisThread = Thread({
            val processor = AnalysisProcessor()
            while (!written.get() || pending.get() != null) {
                val window = pending.getAndSet(null)
                if (window == null) { Thread.sleep(5); continue }
                try { val frame = processor.analyze(window.first, window.second); sink.appendFrame(frame); onFrame(frame) }
                catch (error: Exception) { stop("分析失败：${error.message}") }
            }
        }, "pitch-analysis")
        writerThread = Thread({
            val ring = FloatArray(FFT_SIZE); var cursor = 0; var lastFrame = 0L; var lastCheckpoint = 0L
            fun submit() {
                val window = FloatArray(FFT_SIZE) { ring[(cursor + it) % FFT_SIZE] }
                pending.set(window to sink.samples.toDouble() / SAMPLE_RATE)
                lastFrame = sink.samples
            }
            try {
                while (!captured.get() || queue.isNotEmpty()) {
                    val block = queue.poll(20, TimeUnit.MILLISECONDS) ?: continue
                    val count = sink.appendPcm(block)
                    for (i in 0 until count) { ring[cursor] = block[i] / 32768f; cursor = (cursor + 1) % FFT_SIZE }
                    if (sink.samples >= PITCH_SIZE && sink.samples - lastFrame >= 1600) submit()
                    if (sink.samples - lastCheckpoint >= SAMPLE_RATE) {
                        sink.checkpoint(); lastCheckpoint = sink.samples
                        if (!sink.hasSpace()) throw java.io.IOException("剩余空间不足")
                    }
                }
                if (sink.samples > lastFrame && sink.samples >= PITCH_SIZE) submit()
            } catch (error: Exception) { stop("保存中断：${error.message}"); queue.clear() }
            finally {
                written.set(true)
                analysisThread.join()
                val message = reason.get()
                try { sink.finish(message, message.isNotEmpty() && message != "已达到 30 分钟") }
                catch (error: Exception) { reason.set("保存未完成：${error.message}；重启后恢复最近落盘数据") }
                onFinished(reason.get())
            }
        }, "pitch-file-writer")
        captureThread = Thread({
            val buffer = ShortArray(960); var accepted = 0L
            try {
                while (running.get() && accepted < MAX_SAMPLES) {
                    val read = source.read(buffer)
                    if (read < 0) { if (running.get()) throw java.io.IOException("麦克风读取失败 ($read)") else break }
                    if (read == 0) { Thread.sleep(2); continue }
                    val count = minOf(read.toLong(), MAX_SAMPLES - accepted).toInt()
                    if (!queue.offer(buffer.copyOf(count))) throw java.io.IOException("存储速度不足，已保留写入部分")
                    accepted += count
                }
                if (accepted == MAX_SAMPLES) reason.compareAndSet("", "已达到 30 分钟")
            } catch (error: Exception) { if (running.get()) reason.compareAndSet("", "采集结束：${error.message}") }
            finally { running.set(false); runCatching { source.stop() }; runCatching { source.close() }; captured.set(true) }
        }, "pitch-capture")
        analysisThread.start(); writerThread.start(); captureThread.start()
    }
    fun stop(message: String = "") {
        if (message.isNotEmpty()) reason.compareAndSet("", message)
        running.set(false); runCatching { source.stop() }
    }
    fun awaitStopped(timeoutMs: Long): Boolean {
        if (!::writerThread.isInitialized) return true
        writerThread.join(timeoutMs)
        return !writerThread.isAlive
    }
}
