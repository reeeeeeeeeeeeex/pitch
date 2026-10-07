package app.pitchstudio.android

import android.Manifest
import android.net.Uri
import android.graphics.BitmapFactory
import androidx.compose.ui.test.*
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
import androidx.test.rule.GrantPermissionRule
import androidx.test.platform.app.InstrumentationRegistry
import app.pitchstudio.core.*
import java.io.File
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*

class StudioTest {
    @get:Rule(order = 0) val permission = GrantPermissionRule.grant(Manifest.permission.RECORD_AUDIO)
    @get:Rule(order = 1) val compose = createAndroidComposeRule<MainActivity>()
    private val vm get() = compose.activity.studio
    private fun until(condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 15000
        while (!condition() && System.currentTimeMillis() < deadline) Thread.sleep(25)
        assertTrue("等待状态超时：${vm.state.value.message}", condition())
    }

    @Test fun livePitchFreezeNavigationPlaybackAndPng() {
        compose.onNodeWithText("声见", useUnmergedTree = true).assertDoesNotExist()
        until { !vm.state.value.busy }
        val source = SyntheticSource()
        compose.runOnUiThread { vm.engine.start(true, testSource = source) }
        until { vm.state.value.frame?.pitch?.note == 57 }
        val expectedId = vm.engine.state.value.session!!.meta.id
        assertEquals(expectedId, vm.state.value.meta!!.id)
        assertEquals(57, vm.state.value.frame!!.pitch!!.note)
        compose.runOnUiThread { vm.setPitchLow(21) }
        until { vm.state.value.display.pitchLow > 21 }
        compose.runOnUiThread { vm.freeze(); vm.setPitchLow(36) }
        Thread.sleep(200)
        assertEquals(36, vm.state.value.display.pitchLow)
        source.frequency = 880.0
        compose.runOnUiThread { vm.freeze() }
        until { vm.state.value.frame?.pitch?.note == 81 && vm.state.value.display.pitchLow > 48 }
        for (view in View.entries) { compose.runOnUiThread { vm.view(view) }; Thread.sleep(100) }
        compose.runOnUiThread { vm.window(10); vm.navigate(0.0) }
        assertFalse(vm.state.value.following)
        assertTrue(vm.state.value.active)
        compose.runOnUiThread { vm.stop() }
        until { !vm.state.value.active && vm.state.value.meta?.complete == true }
        val saved = vm.state.value.meta!!
        assertEquals(expectedId, saved.id)
        assertTrue(saved.samples > 0)
        compose.runOnUiThread { vm.setPitchLow(48); vm.play() }
        until { vm.state.value.playing }
        Thread.sleep(200); assertEquals("active=${vm.state.value.active}, busy=${vm.state.value.busy}, display=${vm.state.value.display}, session=${vm.state.value.meta?.id}, expected=$expectedId", 48, vm.state.value.display.pitchLow)
        compose.runOnUiThread { vm.pause(); vm.seek(saved.duration / 2) }
        val image = File(compose.activity.cacheDir, "visible.png")
        compose.runOnUiThread { vm.exportImage(Uri.fromFile(image), false) }
        until { image.length() > 1000 && !vm.state.value.busy }
        BitmapFactory.decodeFile(image.path).let { assertEquals(1600, it.width); assertEquals(1240, it.height); it.recycle() }
        val output = File(compose.activity.getExternalFilesDir(null), "validation")
        output.mkdirs(); image.copyTo(File(output, "visible.png"), true)
        compose.runOnUiThread { vm.view(View.PITCH) }
        compose.onRoot().captureToImage().asAndroidBitmap().let { bitmap -> File(output, "main.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) } }
    }
    @Test fun leavingForegroundEndsAndPersistsCapture() {
        until { !vm.state.value.busy }
        val source = SyntheticSource()
        compose.runOnUiThread { vm.engine.start(true, testSource = source) }
        until { vm.state.value.frame != null }
        val model = vm
        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        val deadline = System.currentTimeMillis() + 10000
        while (model.state.value.active && System.currentTimeMillis() < deadline) Thread.sleep(25)
        assertFalse(model.state.value.active)
        assertTrue(model.state.value.meta!!.complete)
        assertTrue(model.repository.list().any { it.id == model.state.value.meta!!.id })
        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        assertFalse(model.state.value.active)
    }
    @Test fun actualAudioRecordCapturesAndReleases() {
        repeat(2) {
            until { !vm.state.value.busy }
            compose.runOnUiThread { vm.start(true) }
            until { vm.state.value.active || vm.state.value.message.isNotEmpty() }
            assertTrue(vm.state.value.message, vm.state.value.active)
            until { (vm.state.value.meta?.samples ?: 0) > 4800 }
            compose.runOnUiThread { vm.stop() }
            until { !vm.state.value.active && vm.state.value.meta?.complete == true }
            assertEquals(48000, vm.state.value.meta!!.settings.sampleRate)
        }
    }
    @Test fun pendingSessionRestoreBlocksCaptureStart() {
        until { !vm.state.value.busy }
        val id = vm.repository.list().maxByOrNull { it.samples }?.id ?: run {
            vm.repository.create(false, InputSettings()).use {
                it.appendPcm(ShortArray(4800)); it.finish(); it.meta.id
            }
        }
        compose.runOnUiThread {
            vm.load(id)
            assertTrue(vm.state.value.busy)
            vm.start(true)
            assertFalse(vm.engine.state.value.active)
        }
        until { !vm.state.value.busy && vm.state.value.meta?.id == id }
        assertFalse(vm.state.value.active)
    }
}
