package app.pitchstudio.core

import java.io.Closeable
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import kotlin.math.*

/** One fixed gain per recording preserves dynamics and avoids pumping during silence. */
fun playbackGain(peak: Float): Float =
    if (!peak.isFinite() || peak < .001f) 1f else (0.7079458f / peak).coerceIn(1f, 16f)

/** Read-only, bounded-memory view of our canonical 44-byte-header PCM16 WAV files. */
class PlaybackWav(file: File, val gain: Float) : Closeable {
    private val input = RandomAccessFile(file, "r")
    val size = input.length()
    private val scratch = ByteArray(65538)
    private var closed = false
    init {
        if (!gain.isFinite() || gain !in 1f..16f || size < 44 || (size - 44) % 2 != 0L) {
            input.close(); throw IOException("Invalid playback data")
        }
    }

    @Synchronized fun readAt(position: Long, buffer: ByteArray, offset: Int, count: Int): Int {
        if (closed) throw IOException("Playback is closed")
        require(position >= 0 && offset >= 0 && count >= 0 && offset <= buffer.size - count)
        if (count == 0) return 0
        if (position >= size) return -1
        val length = minOf(count.toLong(), size - position, 65536L).toInt()
        if (gain == 1f) { input.seek(position); input.readFully(buffer, offset, length); return length }
        // The platform may read across the header or seek to an odd byte. Always transform
        // complete little-endian samples, then return precisely the requested byte slice.
        val alignedStart = position and -2L
        val alignedEnd = (position + length + 1) and -2L
        val bytes = (alignedEnd - alignedStart).toInt()
        input.seek(alignedStart); input.readFully(scratch, 0, bytes)
        var i = maxOf(0L, 44 - alignedStart).toInt()
        while (i < bytes) {
            val sample = ((scratch[i].toInt() and 255) or (scratch[i + 1].toInt() shl 8)).toShort().toInt()
            val amplified = (sample * gain).roundToInt().coerceIn(-32768, 32767)
            scratch[i] = amplified.toByte(); scratch[i + 1] = (amplified shr 8).toByte()
            i += 2
        }
        scratch.copyInto(buffer, offset, (position - alignedStart).toInt(), (position - alignedStart).toInt() + length)
        return length
    }

    @Synchronized override fun close() { if (!closed) { closed = true; input.close() } }
}
