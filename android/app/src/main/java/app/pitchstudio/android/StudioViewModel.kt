package app.pitchstudio.android

import android.app.Application
import android.media.AudioManager
import android.net.Uri
import androidx.core.content.edit
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.pitchstudio.android.audio.AudioEngine
import app.pitchstudio.android.audio.PianoEngine
import app.pitchstudio.android.audio.RecordingPlayer
import app.pitchstudio.core.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import java.io.File
import kotlin.math.*

data class StudioState(
    val active: Boolean = false, val stopping: Boolean = false, val busy: Boolean = false,
    val meta: SessionMeta? = null, val frame: AnalysisFrame? = null,
    val display: DisplaySettings = DisplaySettings(), val view: View = View.PITCH,
    val range: TimeRange = TimeRange(0.0, 30.0), val following: Boolean = true,
    val frozen: Boolean = false, val frames: List<HistoryFrame> = emptyList(),
    val frozenAt: Double? = null,
    val envelope: List<Envelope> = emptyList(), val overview: List<Envelope> = emptyList(),
    val cursor: Double? = null, val playing: Boolean = false,
    val sessions: List<SessionMeta> = emptyList(), val message: String = "",
    val probe: String? = null, val deviceId: Int? = null,
)

class StudioViewModel(application: Application) : AndroidViewModel(application) {
    private val preferences = application.getSharedPreferences("preferences", Application.MODE_PRIVATE)
    private val selectedLanguage = MutableStateFlow(Language.fromCode(preferences.getString("language", null)))
    val language = selectedLanguage.asStateFlow()
    fun selectLanguage(value: Language) {
        preferences.edit { putString("language", value.code) }
        selectedLanguage.value = value
    }
    val repository = SessionRepository(File(application.filesDir, "sessions"))
    val engine = AudioEngine(application, repository)
    val piano = PianoEngine(application)
    private val mutable = MutableStateFlow(StudioState(sessions = repository.list()))
    val state = mutable.asStateFlow()
    private var current: SessionHandle? = null
    private var player: RecordingPlayer? = null
    private var frozenFrame: AnalysisFrame? = null
    private var cutoff: Double? = null
    private var viewStart = 0.0
    private var pitchDragging = false
    private var cacheKey = ""
    private var displaySave: Job? = null
    @Volatile private var foreground = false
    init {
        viewModelScope.launch {
            engine.state.collect { value ->
                if (value.session != null && current !== value.session) {
                    current?.close(); current = value.session; cacheKey = ""
                }
                mutable.update { s ->
                    val low = if (value.active && !s.frozen && !pitchDragging && value.frame?.pitch != null)
                        followPitch(s.display.pitchLow, value.frame?.pitch?.midi) else s.display.pitchLow
                    s.copy(active = value.active, stopping = value.stopping, meta = current?.meta,
                        frame = if (s.frozen) frozenFrame else value.frame ?: current?.latest,
                        display = s.display.copy(pitchLow = low, pitchFollowing = if (value.active && !s.frozen && !pitchDragging && value.frame?.pitch != null) true else s.display.pitchFollowing),
                        message = value.message.ifBlank { s.message },
                        sessions = if (!value.active) repository.list() else s.sessions)
                }
            }
        }
        viewModelScope.launch {
            repository.list().firstOrNull()?.let { load(it.id) }
            while (isActive) {
                runCatching { refresh() }.onFailure { error -> if (error !is CancellationException) message("Unable to load chart data: ${error.message}") }
                delay(40)
            }
        }
    }
    fun message(text: String) { mutable.update { it.copy(message = text) } }
    fun clearMessage() = message("")
    fun selectDevice(id: Int?) { mutable.update { it.copy(deviceId = id) } }
    fun devices(): List<Pair<Int, String>> = getApplication<Application>().getSystemService(AudioManager::class.java)
        .getDevices(AudioManager.GET_DEVICES_INPUTS).map { it.id to it.productName.toString() }

    fun start(recorded: Boolean) {
        if (state.value.active || state.value.busy || !foreground) return
        displaySave?.cancel()
        pause(); player?.release(); player = null
        cutoff = null; frozenFrame = null; viewStart = 0.0; pitchDragging = false
        mutable.update { it.copy(busy = true, cursor = null, following = true, frozen = false, frozenAt = null, message = "", display = it.display.copy(pitchLow = 48, pitchFollowing = true)) }
        viewModelScope.launch {
            try { withContext(Dispatchers.IO) {
                if (!foreground) return@withContext
                engine.start(recorded, state.value.deviceId)
                if (!foreground) engine.stop("Capture stopped because the app left the foreground.")
            } }
            catch (e: Exception) { message(e.message ?: "Unable to start capture") }
            finally { mutable.update { it.copy(busy = false) } }
        }
    }
    fun stop() = engine.stop()
    fun foreground() { foreground = true }
    fun background() { foreground = false; if (state.value.active) engine.stop("The app left the foreground. Your recording and analysis have been saved."); pause(); piano.stopAll() }
    fun playPiano(note: Int) { target(note); piano.play(note, ::message) }
    fun freeze() {
        if (state.value.frozen) { cutoff = null; frozenFrame = null }
        else { cutoff = current?.meta?.duration; frozenFrame = current?.latest }
        mutable.update { it.copy(frozen = !it.frozen, frozenAt = cutoff) }; cacheKey = ""
    }
    fun view(view: View) {
        updateDisplay(state.value.display.copy(mobileView = view.name.lowercase(), view = if (view == View.PITCH) state.value.display.view else view.name.lowercase()))
        mutable.update { it.copy(view = view, probe = null) }; cacheKey = ""
    }
    fun window(seconds: Int) { updateDisplay(state.value.display.copy(windowSeconds = seconds)); cacheKey = "" }
    fun target(note: Int?) = updateDisplay(state.value.display.copy(target = note))
    fun details(ms: Int = state.value.display.milliseconds, gain: Int = state.value.display.gain) = updateDisplay(state.value.display.copy(milliseconds = ms, gain = gain))
    fun pitchDrag(value: Boolean) { pitchDragging = value }
    fun panPitch(delta: Int) = updateDisplay(state.value.display.copy(pitchLow = (state.value.display.pitchLow + delta).coerceIn(21, 84), pitchFollowing = false))
    fun setPitchLow(low: Int) = updateDisplay(state.value.display.copy(pitchLow = low.coerceIn(21, 84), pitchFollowing = false))
    fun navigate(start: Double) { viewStart = max(0.0, start); mutable.update { it.copy(following = false) }; cacheKey = "" }
    fun live() { mutable.update { it.copy(following = true) }; cacheKey = "" }
    private fun updateDisplay(display: DisplaySettings) {
        mutable.update { it.copy(display = display) }
        current?.updateDisplay(display)
        displaySave?.cancel()
        if (!state.value.active) displaySave = viewModelScope.launch {
            delay(300)
            try { withContext(Dispatchers.IO) { current?.checkpoint() } }
            catch (e: Exception) { if (e !is CancellationException) message("Unable to save display settings: ${e.message}") }
        }
    }
    private suspend fun refresh() {
        val session = current ?: return
        val s = state.value
        val duration = cutoff ?: session.meta.duration
        val cursor = player?.let { runCatching { it.currentPosition / 1000.0 }.getOrNull() } ?: s.cursor
        val playing = player?.let { runCatching { it.isPlaying }.getOrDefault(false) } ?: false
        if (playing && cursor != null && s.following && (cursor < s.range.start || cursor > s.range.end)) viewStart = max(0.0, cursor - s.range.span / 2)
        val range = timeRange(duration, s.display.windowSeconds, s.following && !playing, viewStart)
        val key = "${session.meta.id}|${range.start}|${range.end}|$duration|${s.view}"
        var frames = s.frames; var envelope = s.envelope; var overview = s.overview
        if (key != cacheKey) {
            val result = withContext(Dispatchers.IO) {
                Triple(session.frames(TimeRange(range.start, min(range.end, duration)), 650),
                    session.envelopeIndex.visible(TimeRange(range.start, min(range.end, duration)), 600),
                    session.envelopeIndex.visible(TimeRange(0.0, duration), 600))
            }
            if (session !== current) return
            frames = result.first; envelope = result.second; overview = result.third; cacheKey = key
        }
        val latestState = state.value
        if (s.frozen != latestState.frozen || s.view != latestState.view || s.following != latestState.following || s.display.windowSeconds != latestState.display.windowSeconds) { cacheKey = ""; return }
        val guide = if (cursor != null) session.near(cursor)?.hz else frames.lastOrNull { it.hz > 0 }?.hz
        mutable.update {
            val low = if (!it.active && it.display.pitchFollowing && !pitchDragging && !it.frozen)
                followPitch(it.display.pitchLow, guide?.takeIf { hz -> hz > 0 }?.let { hz -> 69 + 12 * log2(hz / 440.0) }) else it.display.pitchLow
            it.copy(meta = session.meta, range = range, frames = frames, envelope = envelope, overview = overview,
                cursor = cursor, playing = playing, display = it.display.copy(pitchLow = low), frame = if (it.frozen) frozenFrame else session.latest)
        }
    }
    fun load(id: String) {
        if (state.value.active || state.value.busy) return
        displaySave?.cancel()
        viewModelScope.launch {
            mutable.update { it.copy(busy = true) }
            try {
                val loaded = withContext(Dispatchers.IO) { repository.open(id) }
                pause(); player?.release(); player = null; current?.close(); current = loaded
                viewStart = 0.0; cutoff = null; frozenFrame = null; cacheKey = ""
                mutable.value = state.value.copy(meta = loaded.meta, frame = loaded.latest, display = loaded.meta.display,
                    view = View.entries.firstOrNull { it.name.lowercase() == loaded.meta.display.mobileView } ?: View.PITCH,
                    cursor = null, following = false, frozen = false, frozenAt = null, busy = false, playing = false, probe = null)
            } catch (e: Exception) { message("Unable to open session: ${e.message}") }
            finally { mutable.update { it.copy(busy = false) } }
        }
    }
    fun play() {
        if (state.value.active || state.value.busy || current?.meta?.recorded != true) return
        try {
            if (player == null) player = RecordingPlayer(current!!,
                completed = { mutable.update { s -> s.copy(playing = false) } },
                failed = { player?.release(); player = null; mutable.update { it.copy(playing = false, message = "Playback failed. Please try again.") } }).apply {
                state.value.cursor?.let { seekTo((it * 1000).toInt()) }
            }
            if (player!!.isPlaying) pause() else { player!!.start(); mutable.update { it.copy(playing = true) } }
        } catch (e: Exception) { player?.release(); player = null; mutable.update { it.copy(playing = false, message = "Playback failed: ${e.message}") } }
    }
    fun pause() { player?.let { runCatching { if (it.isPlaying) it.pause() } }; mutable.update { it.copy(playing = false) } }
    fun seek(time: Double) {
        if (state.value.active) return
        val t = time.coerceIn(0.0, current?.meta?.duration ?: 0.0)
        player?.seekTo((t * 1000).toInt()); mutable.update { it.copy(cursor = t) }
    }
    fun probe(time: Double, hz: Double? = null) {
        val frame = current?.near(time)
        val text = when {
            hz != null -> {
                val band = (frequencyRatio(hz) * BANDS).toInt().coerceIn(0, BANDS - 1)
                val db = frame?.let { (it.spectrum[band].toInt() and 255) / 255.0 * 85 - 100 }
                "${formatTime(time)} · ${hz.roundToInt()} Hz · " + (db?.let { "%.1f dB".format(it) } ?: "No data")
            }
            state.value.view == View.WAVEFORM -> {
                val e = current?.envelopeIndex?.visible(TimeRange(max(0.0, time - .01), time + .01), 4)?.minByOrNull { abs(it.time - time) }
                "${formatTime(time)} · " + (e?.let { "Amplitude %.3f — %.3f".format(it.min, it.max) } ?: "No data")
            }
            else -> "${formatTime(time)} · " + (frame?.hz?.takeIf { it > 0 }?.let { "${noteName((69 + 12 * log2(it / 440.0)).roundToInt())} · %.1f Hz".format(it) } ?: "No steady pitch")
        }
        mutable.update { it.copy(probe = text) }
    }
    fun probeSpectrum(hz: Double) {
        val spectrum = state.value.frame?.spectrum
        val bin = (hz * FFT_SIZE / SAMPLE_RATE).roundToInt().coerceIn(0, FFT_SIZE / 2 - 1)
        mutable.update { it.copy(probe = "%.1f Hz · %s".format(hz, spectrum?.let { "%.1f dB".format(it[bin]) } ?: "No data")) }
    }
    fun import(uri: Uri) = work("Import") {
        val session = getApplication<Application>().contentResolver.openInputStream(uri)!!.use { SessionCodec.import(repository, it) }
        session.close()
        withContext(Dispatchers.Main) { mutable.update { it.copy(busy = false, sessions = repository.list()) }; load(session.meta.id) }
    }
    fun export(uri: Uri, kind: String) = work("Export") {
        val session = current ?: error("No session to export")
        require(!state.value.active)
        getApplication<Application>().contentResolver.openOutputStream(uri, "wt")!!.use { output ->
            when (kind) {
                "wav" -> { require(session.meta.recorded); session.wavFile.inputStream().use { it.copyTo(output, 65536) } }
                "session" -> SessionCodec.export(session, output)
            }
        }
        message("Export complete")
    }
    fun exportImage(uri: Uri, whole: Boolean) = work("Save image") {
        val session = current ?: error("No session to export")
        val s = state.value
        val range = if (whole) TimeRange(0.0, max(1.0, session.meta.duration)) else s.range
        app.pitchstudio.android.ui.ChartRenderer.export(getApplication<Application>(), uri, session, s, range,
            AppStrings(getApplication(), language.value))
        message("Image saved")
    }
    fun rename(id: String, name: String) = work("Rename") {
        if (current?.meta?.id == id) { current!!.updateMeta(current!!.meta.copy(name = name.take(200))); current!!.checkpoint() }
        else repository.rename(id, name)
        mutable.update { it.copy(sessions = repository.list()) }
    }
    fun delete(id: String) = work("Delete") {
        withContext(Dispatchers.Main) {
            displaySave?.cancelAndJoin()
            if (current?.meta?.id == id) { pause(); player?.release(); player = null; current?.close(); current = null; mutable.value = StudioState(busy = true) }
        }
        repository.delete(id); mutable.update { it.copy(sessions = repository.list()) }
    }
    private fun work(label: String, block: suspend () -> Unit) {
        if (state.value.busy || state.value.active) return
        mutable.update { it.copy(busy = true) }
        viewModelScope.launch {
            try { withContext(Dispatchers.IO) { block() } }
            catch (e: Exception) { if (e !is CancellationException) message("$label failed: ${e.message}") }
            finally { mutable.update { it.copy(busy = false) } }
        }
    }
    override fun onCleared() {
        engine.stop("Capture stopped because the app closed."); player?.release(); piano.close()
        Thread { engine.awaitStopped(10000); current?.close() }.start()
    }
}
