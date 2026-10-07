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
        if (minimum <= 0 || record.state != AudioRecord.STATE_INITIALIZED || record.sampleRate != SAMPLE_RATE) { record.release(); error("设备无法提供 48 kHz 单声道 PCM 输入") }
        val device = manager.getDevices(AudioManager.GET_DEVICES_INPUTS).firstOrNull { it.id == deviceId }
        if (device != null && !record.setPreferredDevice(device)) { record.release(); error("无法选择此麦克风") }
        settings = InputSettings(source = if (source == MediaRecorder.AudioSource.UNPROCESSED) "UNPROCESSED" else "VOICE_RECOGNITION", device = device?.productName?.toString() ?: "系统默认麦克风",
            echoCancellation = if (AcousticEchoCanceler.isAvailable()) disable(AcousticEchoCanceler.create(record.audioSessionId)) else null,
            noiseSuppression = if (NoiseSuppressor.isAvailable()) disable(NoiseSuppressor.create(record.audioSessionId)) else null,
            autoGainControl = if (AutomaticGainControl.isAvailable()) disable(AutomaticGainControl.create(record.audioSessionId)) else null)
    }
    override fun start() { record.startRecording(); check(record.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "麦克风未能开始采集" } }
    override fun read(buffer: ShortArray): Int {
        val count = record.read(buffer, 0, buffer.size, AudioRecord.READ_BLOCKING)
        if (!stopping) {
            if (record.activeRecordingConfiguration?.isClientSilenced == true) error("麦克风被系统或其他应用占用")
            val route = record.routedDevice?.id
            if (routedId != null && route != null && route != routedId) error("输入设备已改变，请重新开始采集")
            if (route != null) routedId = route
        }
        return count
    }
    override fun stop() { stopping = true; if (record.recordingState == AudioRecord.RECORDSTATE_RECORDING) record.stop() }
    override fun close() { effects.forEach { it.release() }; record.release() }
}
