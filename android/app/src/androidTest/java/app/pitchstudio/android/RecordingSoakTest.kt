package app.pitchstudio.android

import android.os.Debug
import android.os.SystemClock
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import app.pitchstudio.core.*
import java.io.File
import org.junit.*
import org.junit.Assert.*

class RecordingSoakTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    @Test fun realElapsedThirtyMinutes() {
        Assume.assumeTrue(InstrumentationRegistry.getArguments().getString("soak") == "true")
        val vm = compose.activity.studio
        compose.waitUntil(15000) { !vm.state.value.busy }
        val output = File(compose.activity.getExternalFilesDir(null), "soak-results").also { it.mkdirs() }
        val source = SyntheticSource()
        val started = SystemClock.elapsedRealtime()
        compose.runOnUiThread { vm.engine.start(true, testSource = source) }
        File(output, "metrics.csv").bufferedWriter().use { log ->
            log.write("elapsedSeconds,samples,frames,javaHeapBytes,pssKB\n")
            var index = 0
            while (vm.state.value.active || vm.state.value.stopping) {
                Thread.sleep(30000)
                val runtime = Runtime.getRuntime(); val state = vm.state.value
                log.write("${(SystemClock.elapsedRealtime() - started) / 1000.0},${state.meta?.samples},${state.meta?.historyBytes?.div(FRAME_BYTES)},${runtime.totalMemory() - runtime.freeMemory()},${Debug.getPss()}\n"); log.flush()
                source.frequency = listOf(110.0, 220.0, 440.0, 880.0)[index % 4]
                source.silent = index % 10 == 5
                compose.runOnUiThread { vm.view(View.entries[index % 4]) }
                index++
                assertTrue("超过 32 分钟未结束", SystemClock.elapsedRealtime() - started < 1920000)
            }
        }
        val elapsed = SystemClock.elapsedRealtime() - started
        assertTrue(elapsed >= 1800000)
        val meta = vm.state.value.meta!!
        assertEquals(MAX_SAMPLES, meta.samples); assertTrue(meta.complete)
        vm.repository.open(meta.id).use { session ->
            assertEquals(172800044L, session.wavFile.length())
            session.wavFile.copyTo(File(output, "recording.wav"), true)
            val archive = File(output, "complete.pitchsession")
            archive.outputStream().use { SessionCodec.export(session, it) }
            archive.inputStream().use { input -> SessionCodec.import(vm.repository, input).use { restored ->
                assertEquals(meta.samples, restored.meta.samples)
                assertEquals(session.wavFile.length(), restored.wavFile.length())
                assertTrue(restored.frames(TimeRange(0.0, 10.0)).isNotEmpty())
                assertTrue(restored.frames(TimeRange(1780.0, 1800.0)).isNotEmpty())
            } }
        }
        File(output, "result.txt").writeText("PASS\nelapsedMs=$elapsed\nsamples=${meta.samples}\nwavBytes=172800044\nhistoryBytes=${meta.historyBytes}\nsource=instrumentation-paced-PCM\n")
    }
}
