package app.pitchstudio.android

import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import app.pitchstudio.core.*
import java.io.File
import org.junit.*
import org.junit.Assert.*

class RecoveryDeviceTest {
    @Test fun prepareCrashFixture() {
        Assume.assumeTrue(InstrumentationRegistry.getArguments().getString("crashFixture") == "true")
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            lateinit var vm: StudioViewModel
            lateinit var marker: File
            scenario.onActivity {
                vm = it.studio
                marker = File(it.getExternalFilesDir(null), "crash-ready.txt")
            }
            marker.delete()
            while (vm.state.value.busy) Thread.sleep(25)
            InstrumentationRegistry.getInstrumentation().runOnMainSync { vm.engine.start(true, testSource = SyntheticSource()) }
            while ((vm.state.value.meta?.samples ?: 0) < 120000) Thread.sleep(25)
            marker.writeText("${vm.state.value.meta!!.id}\n${vm.state.value.meta!!.samples}\n")
            Thread.sleep(60000)
            vm.stop()
            fail("Harness must force-stop this test after crash-ready.txt appears")
        }
    }
    @Test fun appRestartRecoversCheckpointAfterForcedTermination() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val marker = File(context.getExternalFilesDir(null), "crash-ready.txt")
        Assume.assumeTrue(marker.exists())
        val id = marker.readLines()[0]
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            lateinit var vm: StudioViewModel
            scenario.onActivity { vm = it.studio }
            val deadline = System.currentTimeMillis() + 15000
            while (vm.state.value.meta?.id != id && System.currentTimeMillis() < deadline) Thread.sleep(25)
            assertEquals(id, vm.state.value.meta!!.id)
            val meta = vm.state.value.meta!!
            assertTrue(meta.complete); assertTrue(meta.interrupted); assertFalse(vm.state.value.active)
            assertTrue(meta.samples >= 96000)
            vm.repository.open(id).use { session ->
                assertEquals(44 + meta.samples * 2, session.wavFile.length())
                assertTrue(session.frames(TimeRange(0.0, meta.duration)).isNotEmpty())
                assertTrue(session.frames(TimeRange(0.0, meta.duration)).last().time <= meta.duration)
            }
            File(context.getExternalFilesDir(null), "crash-result.txt").writeText("PASS\nid=$id\nsamples=${meta.samples}\nreason=${meta.reason}\n")
        }
    }
}
