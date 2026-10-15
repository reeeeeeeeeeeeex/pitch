package app.pitchstudio.android

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.*
import org.junit.Assert.*

class DocumentPickerTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    @Test fun cancellingExportAndImportKeepsCurrentSession() {
        val vm = compose.activity.studio
        fun until(condition: () -> Boolean) {
            val deadline = System.currentTimeMillis() + 10000
            while (!condition() && System.currentTimeMillis() < deadline) Thread.sleep(25)
            assertTrue("State timeout: ${vm.state.value.message}", condition())
        }
        until { !vm.state.value.busy }
        if (vm.state.value.meta == null) {
            val session = vm.repository.create(true, app.pitchstudio.core.InputSettings())
            session.appendPcm(ShortArray(48000)); session.finish(); val id = session.meta.id; session.close()
            compose.runOnUiThread { vm.load(id) }; until { vm.state.value.meta?.id == id && !vm.state.value.busy }
        }
        val original = vm.state.value.meta!!.id
        val activity = compose.activity
        fun cancelPicker() {
            until { !activity.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED) }
            Thread.sleep(300)
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("input keyevent KEYCODE_BACK").close()
            until { activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) }
            assertEquals(original, vm.state.value.meta!!.id)
            assertFalse(vm.state.value.busy); assertFalse(vm.state.value.active)
        }
        compose.onNodeWithContentDescription("Export").performClick()
        compose.onNodeWithText("Save WAV recording").performClick()
        cancelPicker()
        compose.onNodeWithContentDescription("More").performClick()
        compose.onNodeWithText("Import session").performClick()
        cancelPicker()
    }
}
