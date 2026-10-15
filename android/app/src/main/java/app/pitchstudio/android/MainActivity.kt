package app.pitchstudio.android

import android.os.Bundle
import android.Manifest
import android.content.pm.PackageManager
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import app.pitchstudio.android.ui.*
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    val studio: StudioViewModel by viewModels()
    private var pendingRecord = false
    private var wholeImage = false
    private val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
        if (allowed) studio.start(pendingRecord) else studio.message("Microphone permission was denied. Allow access in system settings, then try again.")
    }
    private val open = registerForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let(studio::import) }
    private val wav = registerForActivityResult(ActivityResultContracts.CreateDocument("audio/wav")) { it?.let { uri -> studio.export(uri, "wav") } }
    private val session = registerForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { it?.let { uri -> studio.export(uri, "session") } }
    private val png = registerForActivityResult(ActivityResultContracts.CreateDocument("image/png")) { it?.let { uri -> studio.exportImage(uri, wholeImage) } }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        volumeControlStream = android.media.AudioManager.STREAM_MUSIC
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT), navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        lifecycleScope.launch { studio.state.collect {
            if (it.active) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } }
        setContent {
            val language = studio.language.collectAsStateWithLifecycle().value
            val strings = remember(language) { AppStrings(this, language) }
            CompositionLocalProvider(LocalAppStrings provides strings) { StudioTheme { StudioScreen(studio, start = { recorded ->
            pendingRecord = recorded
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) studio.start(recorded)
            else permission.launch(Manifest.permission.RECORD_AUDIO)
        }, importFile = { open.launch(arrayOf("application/octet-stream", "*/*")) }, export = { kind, whole ->
            val name = "pitch-${System.currentTimeMillis()}"
            when (kind) { "wav" -> wav.launch("$name.wav"); "session" -> session.launch("$name.pitchsession"); "png" -> { wholeImage = whole; png.launch("$name.png") } }
        }, piano = { PianoReference(studio.state.collectAsStateWithLifecycle().value, studio::playPiano, { studio.target(null) }) }) } } }
    }
    override fun onStart() { super.onStart(); studio.foreground() }
    override fun onStop() { super.onStop(); if (!isChangingConfigurations) studio.background() }
}
