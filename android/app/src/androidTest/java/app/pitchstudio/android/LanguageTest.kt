package app.pitchstudio.android

import android.app.Application
import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import app.pitchstudio.core.View
import java.io.File
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*

class LanguageTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val vm get() = compose.activity.studio
    private fun until(condition: () -> Boolean) = compose.waitUntil(15000, condition)
    private fun choose(label: String) {
        compose.onNodeWithContentDescription("Language / 语言").performClick()
        compose.onNodeWithText(label).performClick()
    }
    @After fun resetLanguage() { compose.runOnUiThread { vm.stop(); vm.selectLanguage(Language.ENGLISH) } }

    @Test fun switchingDuringCapturePreservesSessionAndPreferences() {
        until { !vm.state.value.busy }
        compose.runOnUiThread { vm.selectLanguage(Language.ENGLISH) }
        choose("简体中文")
        compose.onNodeWithText("开始录音").assertIsDisplayed()
        compose.runOnUiThread { vm.engine.start(true, testSource = SyntheticSource()) }
        until { vm.state.value.frame?.pitch?.note == 57 }
        val activity = compose.activity
        val session = vm.engine.state.value.session!!
        val before = session.meta.samples
        compose.runOnUiThread { vm.freeze(); vm.setPitchLow(36); vm.target(60); vm.view(View.SPECTROGRAM) }
        choose("English")
        compose.onNodeWithText("Stop recording").assertIsDisplayed()
        assertSame(activity, compose.activity)
        assertSame(session, vm.engine.state.value.session)
        assertTrue(vm.state.value.active)
        assertTrue(vm.state.value.frozen)
        assertEquals(36, vm.state.value.display.pitchLow)
        assertEquals(60, vm.state.value.display.target)
        assertEquals(View.SPECTROGRAM, vm.state.value.view)
        until { session.meta.samples > before }
        compose.runOnUiThread { vm.stop() }
        until { !vm.state.value.active && vm.state.value.meta?.complete == true }
        val cursorBefore = 0.5
        compose.runOnUiThread { vm.seek(cursorBefore); vm.message("Not a supported .pitchsession file") }
        choose("简体中文")
        compose.onNodeWithText("不是支持的 .pitchsession 文件").assertIsDisplayed()
        assertEquals(cursorBefore, vm.state.value.cursor!!, .001)
        assertEquals("zh-CN", activity.getSharedPreferences("preferences", Application.MODE_PRIVATE).getString("language", null))
        compose.activityRule.scenario.recreate()
        compose.onNodeWithText("开始录音").assertIsDisplayed()
        assertEquals(Language.CHINESE, vm.language.value)
        val folder = File(compose.activity.getExternalFilesDir(null), "language-validation").also { it.mkdirs() }
        compose.waitForIdle()
        InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().let { bitmap ->
            File(folder, "chinese.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
        val png = File(folder, "chinese-export.png")
        compose.runOnUiThread { vm.exportImage(Uri.fromFile(png), true) }
        until { png.length() > 1000 && !vm.state.value.busy }
        compose.onNodeWithContentDescription("更多").performClick()
        compose.onNodeWithText("采集设置").performClick()
        compose.onNodeWithText("回声消除", substring = true).assertIsDisplayed()
        InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("input keyevent KEYCODE_BACK").close()
        compose.waitForIdle()
        choose("English")
        compose.onNodeWithText("Start recording").assertIsDisplayed()
    }

    @Test fun messagesPreserveParametersAndLocalizeDiagnostics() {
        val english = AppStrings(compose.activity, Language.ENGLISH)
        val chinese = AppStrings(compose.activity, Language.CHINESE)
        val tokens = Regex("%[1-9][0-9]*\\\$s|%[+]?\\.\\d+f")
        for ((_, id) in messageCatalog) {
            assertEquals(english.get(id), tokens.findAll(english.get(id)).map { it.value }.sorted().toList(),
                tokens.findAll(chinese.get(id)).map { it.value }.sorted().toList())
        }
        assertEquals("试听 C♯4", chinese.get(R.string.play, "C♯4"))
        assertEquals("分析失败：剩余空间不足", chinese.message("Analysis failed: Insufficient storage space"))
        assertEquals("导入失败：不是支持的 .pitchsession 文件", chinese.message("Import failed: Not a supported .pitchsession file"))
        assertEquals(" · 已中断", chinese.get(R.string.interrupted))
        assertEquals("00:01 · 无稳定音高", chinese.probe("00:01 · No steady pitch"))
        assertEquals("Custom device message", chinese.message("Custom device message"))
    }
}
