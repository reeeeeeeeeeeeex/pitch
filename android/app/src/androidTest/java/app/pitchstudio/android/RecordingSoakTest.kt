package app.pitchstudio.android

import android.os.Debug
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import app.pitchstudio.core.*
import java.io.File
import java.security.MessageDigest
import org.junit.*
import org.junit.Assert.*

/** Explicit opt-in, real wall-clock test. No Compose idling or short coroutine test timeout. */
class RecordingSoakTest {
    @Test fun realElapsedThirtyMinutes() {
        Assume.assumeTrue(InstrumentationRegistry.getArguments().getString("soak") == "true")
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        ActivityScenario.launch(MainActivity::class.java).use { activity ->
            lateinit var vm: StudioViewModel
            lateinit var output: File
            activity.onActivity {
                vm = it.studio
                output = File(it.getExternalFilesDir(null), "soak-results").also(File::mkdirs)
            }
            fun until(condition: () -> Boolean) {
                val deadline = SystemClock.elapsedRealtime() + 15000
                while (!condition() && SystemClock.elapsedRealtime() < deadline) Thread.sleep(25)
                assertTrue("State timeout: ${vm.state.value.message}", condition())
            }
            until { !vm.state.value.busy }
            val source = SyntheticSource()
            val started = SystemClock.elapsedRealtime()
            try {
                instrumentation.runOnMainSync { vm.engine.start(true, testSource = source) }
                until { vm.state.value.active }
                File(output, "metrics.csv").bufferedWriter().use { log ->
                    log.write("elapsedSeconds,samples,frames,javaHeapBytes,pssKB\n")
                    var index = 0
                    while (vm.state.value.active || vm.state.value.stopping) {
                        Thread.sleep(30000)
                        val runtime = Runtime.getRuntime(); val state = vm.state.value
                        val line = "${(SystemClock.elapsedRealtime() - started) / 1000.0},${state.meta?.samples},${state.meta?.historyBytes?.div(FRAME_BYTES)},${runtime.totalMemory() - runtime.freeMemory()},${Debug.getPss()}"
                        log.write("$line\n"); log.flush()
                        android.util.Log.i("PitchSoak", line)
                        source.frequency = listOf(110.0, 220.0, 440.0, 880.0)[index % 4]
                        source.silent = index % 10 == 5
                        instrumentation.runOnMainSync { vm.view(View.entries[index % 4]) }
                        index++
                        assertTrue("Did not stop within 32 minutes", SystemClock.elapsedRealtime() - started < 1920000)
                    }
                }
                val elapsed = SystemClock.elapsedRealtime() - started
                assertTrue(elapsed >= 1800000)
                val meta = vm.state.value.meta!!
                assertEquals(MAX_SAMPLES, meta.samples); assertTrue(meta.complete)
                assertEquals("已达到 30 分钟", meta.reason)
                fun digest(file: File): String {
                    val hash = MessageDigest.getInstance("SHA-256")
                    file.inputStream().use { input ->
                        val buffer = ByteArray(65536)
                        while (true) { val n = input.read(buffer); if (n < 0) break; hash.update(buffer, 0, n) }
                    }
                    return hash.digest().joinToString("") { "%02x".format(it) }
                }
                var checksum = ""
                vm.repository.open(meta.id).use { session ->
                    assertEquals(172800044L, session.wavFile.length())
                    session.wavFile.copyTo(File(output, "recording.wav"), true)
                    checksum = digest(session.wavFile)
                    val archive = File(output, "complete.pitchsession")
                    archive.outputStream().use { SessionCodec.export(session, it) }
                    archive.inputStream().use { input -> SessionCodec.import(vm.repository, input).use { restored ->
                        assertEquals(meta.samples, restored.meta.samples)
                        assertEquals(session.wavFile.length(), restored.wavFile.length())
                        assertEquals(checksum, digest(restored.wavFile))
                        assertTrue(restored.frames(TimeRange(0.0, 10.0)).isNotEmpty())
                        assertTrue(restored.frames(TimeRange(1780.0, 1800.0)).isNotEmpty())
                    } }
                }
                File(output, "result.txt").writeText("PASS\nelapsedMs=$elapsed\nsamples=${meta.samples}\nwavBytes=172800044\nhistoryBytes=${meta.historyBytes}\nwavSha256=$checksum\nsource=instrumentation-paced-PCM\n")
            } finally {
                instrumentation.runOnMainSync { vm.stop() }
                vm.engine.awaitStopped(15000)
            }
        }
    }
}
