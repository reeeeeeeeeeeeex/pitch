package app.pitchstudio.core

import org.junit.Test
import java.io.File
import java.nio.file.Files
import kotlin.test.*

class WebInteropTest {
    @Test fun importWebAndExportForWebReader() {
        val repo = SessionRepository(Files.createTempDirectory("pitch-web-interop").toFile())
        val resource = requireNotNull(javaClass.getResourceAsStream("/web.pitchsession"))
        val session = resource.use { SessionCodec.import(repo, it) }
        assertEquals(48000L, session.meta.samples)
        assertEquals(30, session.frames(TimeRange(0.0, 1.0)).size)
        assertEquals(36, session.meta.display.pitchLow); assertFalse(session.meta.display.pitchFollowing)
        assertNull(session.meta.display.target)
        assertTrue(kotlin.math.abs(requireNotNull(session.latest?.pitch).hz - 220) < 1)
        val output = File("build/interop/android.pitchsession"); output.parentFile.mkdirs()
        output.outputStream().use { SessionCodec.export(session, it) }
        session.close()
    }
}
