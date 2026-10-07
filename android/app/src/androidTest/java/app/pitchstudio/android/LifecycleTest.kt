package app.pitchstudio.android

import android.content.pm.ActivityInfo
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class LifecycleTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private fun until(condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 15000
        while (!condition() && System.currentTimeMillis() < deadline) Thread.sleep(25)
        assertTrue("State timeout", condition())
    }
    private fun shell(command: String) {
        InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command).use { descriptor ->
            java.io.FileInputStream(descriptor.fileDescriptor).use { it.readBytes() }
        }
    }
    @Test fun rotationKeepsCaptureAndScreenLockStopsIt() {
        val vm = compose.activity.studio
        until { !vm.state.value.busy }
        compose.runOnUiThread { vm.engine.start(true, testSource = SyntheticSource()) }
        until { (vm.state.value.meta?.samples ?: 0) > 9600 }
        val id = vm.state.value.meta!!.id
        val samples = vm.state.value.meta!!.samples
        compose.runOnUiThread { compose.activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
        until { compose.activity.resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE }
        until { (vm.state.value.meta?.samples ?: 0) > samples + 9600 }
        assertEquals(id, vm.state.value.meta!!.id)
        assertSame(vm, compose.activity.studio)
        assertTrue(vm.state.value.active)
        shell("input keyevent KEYCODE_SLEEP")
        try {
            until { !vm.state.value.active && vm.state.value.meta?.complete == true }
            assertTrue(vm.repository.list().any { it.id == id })
        } finally {
            shell("input keyevent KEYCODE_WAKEUP")
            shell("wm dismiss-keyguard")
        }
        until { compose.activity.lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED) }
        assertFalse(vm.state.value.active)
        compose.runOnUiThread { compose.activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED }
    }
}
