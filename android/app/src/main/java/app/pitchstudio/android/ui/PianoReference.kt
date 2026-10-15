package app.pitchstudio.android.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.pitchstudio.android.StudioState
import app.pitchstudio.core.noteName
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun PianoReference(state: StudioState, play: (Int) -> Unit, clear: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().padding(top = 12.dp).background(Color(0xff192019), RoundedCornerShape(12.dp))
        .clickable { open = true }.heightIn(min = 52.dp).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Default.Piano, null, Modifier.size(21.dp), tint = Secondary)
        Spacer(Modifier.width(10.dp)); Text("Reference piano", fontSize = 14.sp); Spacer(Modifier.weight(1f))
        state.display.target?.let { Text(noteName(it), color = Color(0xffb9a3e3), fontSize = 13.sp) }
        Icon(Icons.Default.ChevronRight, null, tint = Secondary)
    }
    if (!open) return
    val scroll = rememberScrollState()
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val white = remember { (21..108).filter { it % 12 !in listOf(1, 3, 6, 8, 10) } }
    val black = remember { (21..108).filter { it !in white } }
    val unit = with(density) { 64.dp.toPx() }
    LaunchedEffect(Unit) { scroll.scrollTo(((white.indexOf(60) - 1) * unit).toInt()) }
    ModalBottomSheet(onDismissRequest = { open = false }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.padding(bottom = 24.dp)) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Reference piano", fontSize = 20.sp); Spacer(Modifier.weight(1f))
                if (state.display.target != null) TextButton(onClick = clear) { Text("Clear target") }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp)) {
                listOf(21, 24, 36, 48, 60, 72, 84, 96, 108).forEach { note ->
                    TextButton(onClick = { scope.launch { scroll.animateScrollTo((white.indexOf(note) * unit).toInt()) } }) { Text(noteName(note)) }
                }
            }
            Box(Modifier.fillMaxWidth().horizontalScroll(scroll).padding(horizontal = 12.dp)) {
                Box(Modifier.width((white.size * 64).dp).height(184.dp)) {
                    white.forEachIndexed { index, note ->
                        val color = if (state.display.target == note) Color(0xffb9a3e3) else if (state.frame?.pitch?.note == note) Accent else Color(0xffe0e5d6)
                        Box(Modifier.offset(x = (index * 64).dp).width(62.dp).height(184.dp)
                            .background(color, RoundedCornerShape(bottomStart = 5.dp, bottomEnd = 5.dp))
                            .semantics { contentDescription = "Play ${noteName(note)}"; role = Role.Button }
                            .clickable { play(note) }, contentAlignment = Alignment.BottomCenter) {
                            Text(noteName(note), color = Back, fontSize = 11.sp, modifier = Modifier.padding(bottom = 12.dp))
                        }
                    }
                    black.forEach { note ->
                        val before = white.count { it < note }
                        val color = if (state.display.target == note) Color(0xff8264aa) else if (state.frame?.pitch?.note == note) Color(0xff739747) else Color(0xff222a22)
                        Box(Modifier.offset(x = (before * 64 - 24).dp).width(48.dp).height(114.dp)
                            .background(color, RoundedCornerShape(bottomStart = 4.dp, bottomEnd = 4.dp))
                            .border(1.dp, Back, RoundedCornerShape(bottomStart = 4.dp, bottomEnd = 4.dp))
                            .semantics { contentDescription = "Play ${noteName(note)}"; role = Role.Button }
                            .clickable { play(note) })
                    }
                }
            }
            Text("A0–C8 · 88 keys · Headphones recommended", color = Secondary, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 20.dp, vertical = 14.dp))
        }
    }
}
