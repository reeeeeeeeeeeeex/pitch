package app.pitchstudio.android

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*

class PianoTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    @Test fun eightyEightKeysUseDecodedSamplesAndIndependentOutput() {
        val vm = compose.activity.studio
        compose.waitUntil(10000) { !vm.state.value.busy }
        compose.onNodeWithText("Reference piano").performScrollTo().performClick()
        val keys = compose.onAllNodes(SemanticsMatcher("playable piano keys") { node -> node.config.getOrElse(SemanticsProperties.ContentDescription) { emptyList() }.any { Regex("Play [A-G]♯?[0-8]").matches(it) } })
        keys.assertCountEquals(88)
        compose.onNodeWithContentDescription("Play C4").performScrollTo().performClick()
        compose.waitUntil(10000) { vm.piano.samplesPlayed > 1000 }
        assertEquals(60, vm.state.value.display.target)
        assertTrue(vm.piano.decodedSamples > 0)
        assertTrue(vm.piano.lastDecodedPeak > .01f)
        assertFalse(vm.state.value.active)
        val decoded = vm.piano.decodedSamples
        compose.runOnUiThread { vm.playPiano(61) }
        Thread.sleep(200)
        assertEquals(decoded, vm.piano.decodedSamples)
        for (note in listOf(21, 108)) {
            val before = vm.piano.samplesPlayed
            val decodedBefore = vm.piano.decodedSamples
            compose.runOnUiThread { vm.playPiano(note) }
            compose.waitUntil(10000) { vm.piano.samplesPlayed > before + 1000 && vm.piano.decodedSamples > decodedBefore }
            assertEquals(note, vm.state.value.display.target)
        }
        compose.onNodeWithText("Clear target").performClick()
        assertNull(vm.state.value.display.target)
    }
}
