package app.pitchstudio.android.audio

import android.media.AudioAttributes
import android.media.MediaDataSource
import android.media.MediaPlayer
import app.pitchstudio.core.*
import kotlin.math.abs

internal class PlaybackDataSource(private val wav: PlaybackWav) : MediaDataSource() {
    override fun getSize() = wav.size
    override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int) = wav.readAt(position, buffer, offset, size)
    override fun close() = wav.close()
}

/** Gain is applied only to the player's input, never the saved WAV or analysis. */
class RecordingPlayer(session: SessionHandle, completed: () -> Unit, failed: () -> Unit) {
    val gain = playbackGain(session.envelopeIndex.visible(TimeRange(0.0, session.meta.duration), 1)
        .maxOfOrNull { maxOf(abs(it.min), abs(it.max)) } ?: 0f)
    private val source = PlaybackDataSource(PlaybackWav(session.wavFile, gain))
    private val media = MediaPlayer()
    private var released = false
    init {
        try {
            media.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
            media.setVolume(1f, 1f)
            media.setDataSource(source)
            media.setOnCompletionListener { completed() }
            media.setOnErrorListener { _, _, _ -> failed(); true }
            media.prepare()
        } catch (e: Exception) { release(); throw e }
    }
    val currentPosition get() = media.currentPosition
    val isPlaying get() = media.isPlaying
    fun seekTo(milliseconds: Int) = media.seekTo(milliseconds.toLong(), MediaPlayer.SEEK_CLOSEST)
    fun start() = media.start()
    fun pause() = media.pause()
    fun release() {
        if (!released) {
            released = true
            try { media.release() } finally { source.close() }
        }
    }
}
