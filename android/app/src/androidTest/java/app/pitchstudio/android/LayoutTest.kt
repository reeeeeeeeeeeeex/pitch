package app.pitchstudio.android

import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.ui.test.*
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import app.pitchstudio.core.*
import java.io.File
import kotlin.math.*
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*

/** Deterministic local recording for viewport, export and responsive-layout checks. */
class LayoutTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val vm get() = compose.activity.studio
    private fun until(condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 15000
        while (!condition() && System.currentTimeMillis() < deadline) Thread.sleep(25)
        assertTrue("State timeout: ${vm.state.value.message}", condition())
    }
    @Test fun historyPlaybackExportsAndResponsiveLayout() {
        until { !vm.state.value.busy }
        val recording = vm.repository.create(true, InputSettings(source = "test-fixture"))
        val processor = AnalysisProcessor()
        val ring = FloatArray(FFT_SIZE); var ringCursor = 0; var phase = 0.0
        repeat(500) { frame ->
            val block = ShortArray(1920) { index ->
                val time = (frame * 1920 + index) / 48000.0
                val hz = when {
                    time < 4 -> 196.0
                    time < 7 -> 220.0
                    time < 10 -> 261.625565
                    time < 12 -> 329.627557
                    else -> 330 + (time - 12) * 23.75
                }
                phase += 2 * PI * hz / SAMPLE_RATE
                val sample = if (time in 7.0..8.0) 0f else (.22 * sin(phase) + .35 * sin(2 * phase)).toFloat()
                ring[ringCursor] = sample; ringCursor = (ringCursor + 1) % FFT_SIZE
                (sample * 32767).toInt().toShort()
            }
            recording.appendPcm(block)
            if (frame >= 4) recording.appendFrame(processor.analyze(FloatArray(FFT_SIZE) { ring[(ringCursor + it) % FFT_SIZE] }, (frame + 1) * .04))
        }
        recording.updateMeta(recording.meta.copy(name = "Practice session · Synthetic audio"))
        recording.updateDisplay(DisplaySettings(pitchLow = 48, pitchFollowing = false))
        recording.finish(); val id = recording.meta.id; recording.close()
        compose.runOnUiThread { vm.load(id) }
        until { vm.state.value.meta?.id == id && !vm.state.value.busy }
        compose.runOnUiThread { vm.window(10); vm.navigate(0.0) }
        until { vm.state.value.range.start == 0.0 && vm.state.value.range.span == 10.0 && vm.state.value.frames.isNotEmpty() }
        assertTrue(vm.state.value.frames.first().time < 1)
        compose.runOnUiThread { vm.live() }
        until { vm.state.value.range.start == 10.0 }
        compose.runOnUiThread { vm.setPitchLow(48); vm.seek(12.0); vm.play() }
        until { vm.state.value.playing && (vm.state.value.cursor ?: 0.0) > 12.1 }
        assertEquals(48, vm.state.value.display.pitchLow)
        compose.runOnUiThread { vm.pause(); vm.seek(5.0); vm.window(30); vm.navigate(0.0); vm.view(View.PITCH); vm.clearMessage() }
        until { vm.state.value.range.span == 30.0 && !vm.state.value.playing }
        compose.onNodeWithContentDescription("Pitch chart, C3 to C5, 25 semitone lines").assertExists()
        compose.onNodeWithText("Start recording").assertIsDisplayed()
        compose.onNodeWithText("Analyze only").assertIsDisplayed()
        val configuration = compose.activity.resources.configuration
        val name = "${configuration.screenWidthDp}x${configuration.screenHeightDp}-font${configuration.fontScale}"
        val folder = File(compose.activity.getExternalFilesDir(null), "layout-$name").also { it.mkdirs() }
        fun shot(name: String) {
            compose.waitForIdle()
            Thread.sleep(250) // Let the platform compositor present the committed Compose frame.
            InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().let { bitmap ->
                File(folder, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            }
        }
        shot("pitch")
        val beforeScroll = compose.onNodeWithTag("chart-pitch").fetchSemanticsNode().positionInRoot.y
        compose.onRoot().performTouchInput {
            swipe(Offset(width * .4f, height * .65f), Offset(width * .4f, height * .35f), 400)
        }
        val afterScroll = compose.onNodeWithTag("chart-pitch").fetchSemanticsNode().positionInRoot.y
        assertTrue("Vertical chart gestures must let the page scroll", afterScroll < beforeScroll)
        shot("pitch-scrolled")
        compose.onNodeWithText("Pitch").performScrollTo()
        for (view in listOf(View.SPECTROGRAM, View.WAVEFORM, View.SPECTRUM)) {
            compose.runOnUiThread { vm.view(view) }
            Thread.sleep(150)
            shot(view.name.lowercase())
            val png = File(folder, "export-${view.name.lowercase()}.png")
            compose.runOnUiThread { vm.exportImage(Uri.fromFile(png), true) }
            until { png.length() > 1000 && !vm.state.value.busy }
        }
        compose.runOnUiThread { vm.view(View.PITCH); vm.clearMessage() }
        compose.onNodeWithText("Reference piano").performScrollTo().performClick()
        compose.onNodeWithContentDescription("Play C4").assertExists()
        shot("piano")
    }
}
