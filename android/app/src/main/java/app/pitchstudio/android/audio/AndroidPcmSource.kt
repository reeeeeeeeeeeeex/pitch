package app.pitchstudio.android.audio

import android.annotation.SuppressLint
import android.content.Context
import android.media.*
import android.media.audiofx.*
import app.pitchstudio.core.*

@SuppressLint("MissingPermission")
class AndroidPcmSource(context: Context, deviceId: Int? = null) : PcmSource {
    private val manager = context.getSystemService(AudioManager::class.java)
    private val source = if (manager.getProperty(AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED) == "true") MediaRecorder.AudioSource.UNPROCESSED else MediaRecorder.AudioSource.VOICE_RECOGNITION
    private val minimum = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    private val record = AudioRecord.Builder().setAudioSource(source)
        .setAudioFormat(AudioFormat.Builder().setSampleRate(SAMPLE_RATE).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build())
        .setBufferSizeInBytes(maxOf(minimum, SAMPLE_RATE / 2)).build()
    private val effects = mutableListOf<AudioEffect>()
    private fun disable(effect: AudioEffect?): Boolean? = effect?.let { effects.add(it); runCatching { it.enabled = false }; it.enabled }
    override val settings: InputSettings
    @Volatile private var stopping = false
    private var routedId: Int? = null
    init {
        if (minimum <= 0 || record.state != AudioRecord.STATE_INITIALIZED || record.sampleRate != SAMPLE_RATE || record.channelCount != 1 || record.audioFormat != AudioFormat.ENCODING_PCM_16BIT) { record.release(); error("This device cannot provide 48 kHz mono PCM input") }
        val device = manager.getDevices(AudioManager.GET_DEVICES_INPUTS).firstOrNull { it.id == deviceId }
        if (deviceId != null && device == null) { record.release(); error("The selected microphone disconnected. Choose another input.") }
        if (device != null && !record.setPreferredDevice(device)) { record.release(); error("Unable to select this microphone") }
        settings = InputSettings(source = if (source == MediaRecorder.AudioSource.UNPROCESSED) "UNPROCESSED" else "VOICE_RECOGNITION", device = device?.productName?.toString() ?: "System default microphone",
            echoCancellation = if (AcousticEchoCanceler.isAvailable()) disable(AcousticEchoCanceler.create(record.audioSessionId)) else null,
            noiseSuppression = if (NoiseSuppressor.isAvailable()) disable(NoiseSuppressor.create(record.audioSessionId)) else null,
            autoGainControl = if (AutomaticGainControl.isAvailable()) disable(AutomaticGainControl.create(record.audioSessionId)) else null)
    }
    override fun start() { record.startRecording(); check(record.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "The microphone could not start capture" } }
    override fun read(buffer: ShortArray): Int {
        val count = record.read(buffer, 0, buffer.size, AudioRecord.READ_BLOCKING)
        if (!stopping) {
            if (record.activeRecordingConfiguration?.isClientSilenced == true) error("The microphone is in use by the system or another app")
            val route = record.routedDevice?.id
            if (routedId != null && route != null && route != routedId) error("The input device changed. Please start capture again.")
            if (route != null) routedId = route
        }
        return count
    }
    override fun stop() { stopping = true; if (record.recordingState == AudioRecord.RECORDSTATE_RECORDING) record.stop() }
    override fun close() { effects.forEach { it.release() }; record.release() }
}
