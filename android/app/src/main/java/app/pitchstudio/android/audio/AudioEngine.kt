package app.pitchstudio.android.audio

import android.content.Context
import app.pitchstudio.core.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

data class EngineState(val active: Boolean = false, val stopping: Boolean = false,
    val session: SessionHandle? = null, val frame: AnalysisFrame? = null, val message: String = "")

class AudioEngine(private val context: Context, private val repository: SessionRepository) {
    private val mutable = MutableStateFlow(EngineState())
    val state = mutable.asStateFlow()
    private var pipeline: CapturePipeline? = null
    @Synchronized fun start(recorded: Boolean, deviceId: Int? = null, testSource: PcmSource? = null) {
        check(!mutable.value.active && !mutable.value.stopping)
        val input = testSource ?: AndroidPcmSource(context, deviceId)
        val session = repository.create(recorded, input.settings)
        val run = CapturePipeline(input, session,
            onFrame = { frame -> mutable.update { it.copy(frame = frame) } },
            onFinished = { reason -> mutable.value = EngineState(session = session, frame = session.latest, message = reason) })
        pipeline = run
        try { run.start { mutable.value = EngineState(active = true, session = session) } }
        catch (error: Exception) {
            session.close(); repository.delete(session.meta.id)
            mutable.value = EngineState(message = error.message ?: "Unable to start capture")
            throw error
        }
    }
    fun stop(reason: String = "") {
        if (mutable.value.active) {
            mutable.update { it.copy(stopping = true) }
            pipeline?.stop(reason)
        }
    }
    fun awaitStopped(timeout: Long) = pipeline?.awaitStopped(timeout) ?: true
}
