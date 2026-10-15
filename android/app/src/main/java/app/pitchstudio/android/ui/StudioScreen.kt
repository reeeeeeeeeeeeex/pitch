package app.pitchstudio.android.ui

import app.pitchstudio.android.R
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.pitchstudio.android.*
import app.pitchstudio.core.*
import kotlin.math.*

val Accent = Color(0xffbfe783)
val Back = Color(0xff101510)
val Secondary = Color(0xff929f89)
val Coral = Color(0xffdc6963)

@Composable fun StudioTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = darkColorScheme(primary = Accent, onPrimary = Back,
        primaryContainer = Color(0xff283724), onPrimaryContainer = Accent,
        background = Back, surface = Color(0xff192019), onBackground = Color(0xffe6ebdf),
        onSurface = Color(0xffe6ebdf), secondary = Secondary, error = Coral,
        secondaryContainer = Color(0xff293327), onSecondaryContainer = Color(0xffdde9d5),
        surfaceVariant = Color(0xff242d24), onSurfaceVariant = Secondary, surfaceTint = Accent,
        surfaceContainer = Color(0xff192019), surfaceContainerLow = Color(0xff141b14),
        surfaceContainerLowest = Color(0xff0b110c), surfaceContainerHigh = Color(0xff212a21),
        surfaceContainerHighest = Color(0xff2b3429), outline = Color(0xff4a5943), outlineVariant = Color(0xff303b2d)), content = content)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun StudioScreen(vm: StudioViewModel, start: (Boolean) -> Unit,
    importFile: () -> Unit, export: (String, Boolean) -> Unit, piano: @Composable (() -> Unit)? = null) {
    val strings = LocalAppStrings.current
    val s by vm.state.collectAsStateWithLifecycle()
    var menu by remember { mutableStateOf(false) }
    var languageMenu by remember { mutableStateOf(false) }
    var sessions by remember { mutableStateOf(false) }
    var settings by remember { mutableStateOf(false) }
    var exports by remember { mutableStateOf(false) }
    var whole by remember { mutableStateOf(false) }
    var detail by remember { mutableStateOf(false) }
    val density = LocalDensity.current
    Surface(color = Back, modifier = Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).padding(horizontal = 16.dp)) {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                Canvas(Modifier.size(9.dp)) { drawCircle(if (s.active) { if (s.meta?.recorded == true) Coral else Accent } else Secondary) }
                Spacer(Modifier.width(10.dp))
                Text(if (s.active) { if (s.meta?.recorded == true) strings.get(R.string.recording) else strings.get(R.string.analyzing) } else if (s.meta != null) strings.get(R.string.saved) else strings.get(R.string.ready), color = Secondary, fontSize = 14.sp)
                Spacer(Modifier.weight(1f))
                Text(formatTime(s.meta?.duration ?: 0.0), fontFamily = FontFamily.Monospace, color = Secondary)
                Box {
                    IconButton(onClick = { languageMenu = true }) { Icon(Icons.Default.Translate, "Language / 语言") }
                    DropdownMenu(expanded = languageMenu, onDismissRequest = { languageMenu = false }) {
                        DropdownMenuItem(text = { Text("English") }, onClick = { vm.selectLanguage(Language.ENGLISH); languageMenu = false }, trailingIcon = { if (strings.language == Language.ENGLISH) Icon(Icons.Default.Check, null) })
                        DropdownMenuItem(text = { Text("简体中文") }, onClick = { vm.selectLanguage(Language.CHINESE); languageMenu = false }, trailingIcon = { if (strings.language == Language.CHINESE) Icon(Icons.Default.Check, null) })
                    }
                }
                Box {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, strings.get(R.string.more)) }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(text = { Text(strings.get(R.string.saved_sessions)) }, enabled = !s.active && !s.busy, onClick = { menu = false; sessions = true })
                        DropdownMenuItem(text = { Text(strings.get(R.string.import_session)) }, enabled = !s.active && !s.busy, onClick = { menu = false; importFile() })
                        DropdownMenuItem(text = { Text(strings.get(R.string.input_settings)) }, enabled = !s.active, onClick = { menu = false; settings = true })
                    }
                }
            }
            BoxWithConstraints(Modifier.weight(1f)) {
                val chartHeight = maxOf(420.dp * density.fontScale.coerceAtLeast(1f), maxHeight - 320.dp)
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    val pitch = s.frame?.pitch
                    val cents = pitch?.let { p -> s.display.target?.let { (p.midi - it) * 100 } ?: p.cents }
                    FlowRow(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 4.dp), horizontalArrangement = Arrangement.Center,
                        verticalArrangement = Arrangement.Center, maxItemsInEachRow = if (density.fontScale > 1.3f) 1 else 2) {
                        Text(pitch?.let { noteName(it.note) } ?: "—", fontSize = 50.sp, fontWeight = FontWeight.Medium, modifier = Modifier.testTag("pitch-note"))
                        Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                            Text(pitch?.let { "%.1f Hz".format(it.hz) } ?: strings.get(R.string.no_steady_pitch_detected), color = Secondary, fontSize = 14.sp)
                            Text(cents?.let { strings.get(R.string.message_0f_cents).format(it) } ?: strings.get(R.string.waiting_for_audio), color = Accent, fontSize = 14.sp)
                        }
                    }
                    TuningScale(cents, s.frame?.rmsDb ?: -160f)
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
                        listOf(View.PITCH to strings.get(R.string.pitch), View.SPECTROGRAM to strings.get(R.string.spectrogram), View.WAVEFORM to strings.get(R.string.waveform), View.SPECTRUM to strings.get(R.string.spectrum)).forEach { (view, title) ->
                            Column(Modifier.widthIn(min = 80.dp).clickable { vm.view(view) }.heightIn(min = 48.dp).padding(horizontal = 12.dp, vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Bottom) {
                                Text(title, color = if (s.view == view) Accent else Secondary, fontSize = 15.sp)
                                Spacer(Modifier.height(12.dp))
                                Box(Modifier.height(2.dp).width(32.dp).background(if (s.view == view) Accent else Color.Transparent))
                            }
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    Row(Modifier.fillMaxWidth().height(if (s.view == View.PITCH) chartHeight else maxOf(300.dp, chartHeight - 90.dp))) {
                        val current by rememberUpdatedState(s)
                        val chartModifier = Modifier.weight(1f).fillMaxHeight()
                            .testTag("chart-${s.view.name.lowercase()}")
                            .semantics { contentDescription = if (s.view == View.PITCH) strings.get(R.string.pitch_chart_to_25_semitone_lines, noteName(s.display.pitchLow), noteName(s.display.pitchLow + 24)) else strings.get(R.string.chart, strings.viewName(s.view)) }
                            .pointerInput(s.view) {
                                detectTapGestures(onTap = { p ->
                                    val label = with(density) { 10.sp.toPx() }
                                    val ratio = ((p.x - label * 3.2f) / (size.width - label * 4.2f)).coerceIn(0f, 1f)
                                    val t = current.range.start + current.range.span * ratio
                                    if (current.view == View.SPECTRUM) vm.probeSpectrum(frequencyAt(ratio.toDouble()))
                                    else { vm.probe(t, if (current.view == View.SPECTROGRAM) frequencyAt((1 - (p.y - label * 1.2f) / (size.height - label * 3.6f)).toDouble().coerceIn(0.0, 1.0)) else null); vm.seek(t) }
                                }, onLongPress = { p -> vm.probe(current.range.start + current.range.span * (p.x / size.width).coerceIn(0f, 1f)) })
                            }.pointerInput(s.view) {
                                var horizontal = 0f; var startTime = 0.0
                                detectHorizontalDragGestures(onDragStart = { horizontal = 0f; startTime = current.range.start }) { change, amount ->
                                    change.consume(); horizontal += amount
                                    if (current.view == View.SPECTRUM) {
                                        val label = with(density) { 10.sp.toPx() }
                                        vm.probeSpectrum(frequencyAt(((change.position.x - label * 3.2f) / (size.width - label * 4.2f)).toDouble().coerceIn(0.0, 1.0)))
                                    }
                                    else vm.navigate(startTime - horizontal / size.width * current.range.span)
                                }
                            }
                        Canvas(chartModifier) { drawIntoCanvas { ChartRenderer.draw(it.nativeCanvas, size.width, size.height, s.view, s, with(density) { 10.sp.toPx() }) } }
                        if (s.view == View.PITCH) PitchScroll(s, vm)
                    }
                    if (s.view == View.SPECTROGRAM) Canvas(Modifier.fillMaxWidth().height(34.dp).padding(horizontal = 36.dp)) {
                        drawIntoCanvas { ChartRenderer.colorScale(it.nativeCanvas, 0f, 0f, size.width, with(density) { 10.sp.toPx() }) }
                    }
                    s.probe?.let { Text(strings.probe(it), color = Secondary, fontSize = 11.sp, modifier = Modifier.padding(start = 12.dp, top = 4.dp)) }
                    if (s.view == View.WAVEFORM) {
                        TextButton(onClick = { detail = !detail }) { Text(if (detail) strings.get(R.string.hide_waveform_detail) else strings.get(R.string.waveform_detail_ms)) }
                        if (detail) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Choice(listOf(5, 10, 20, 50), s.display.milliseconds, { "$it ms" }) { vm.details(ms = it) }
                                Choice(listOf(1, 2, 4, 8), s.display.gain, { "×$it" }) { vm.details(gain = it) }
                                Text(strings.get(R.string.live_last_snapshot), fontSize = 11.sp, color = Secondary)
                            }
                            Canvas(Modifier.fillMaxWidth().height(130.dp)) { drawIntoCanvas { ChartRenderer.detail(it.nativeCanvas, size.width, size.height, s, with(density) { 11.sp.toPx() }) } }
                        }
                    }
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                        Choice(listOf(10, 30, 60, 300, 0), s.display.windowSeconds, { when (it) { 0 -> strings.get(R.string.all); 60 -> strings.get(R.string.message_1_min); 300 -> strings.get(R.string.message_5_min); else -> strings.get(R.string.sec, it) } }, vm::window)
                        Spacer(Modifier.weight(1f))
                        if (!s.following) TextButton(onClick = vm::live) { Text(strings.get(R.string.go_live), fontSize = 12.sp) }
                        IconButton(onClick = vm::freeze, enabled = s.meta != null) { Icon(if (s.frozen) Icons.Default.PlayArrow else Icons.Default.AcUnit, if (s.frozen) strings.get(R.string.resume_display) else strings.get(R.string.freeze_display), tint = if (s.frozen) Accent else Secondary) }
                    }
                    Overview(s, vm)
                    piano?.invoke()
                    Spacer(Modifier.height(8.dp))
                }
            }
            if (s.message.isNotBlank()) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(strings.message(s.message), modifier = Modifier.weight(1f), fontSize = 12.sp, color = if (s.message.contains("failed", ignoreCase = true) || s.message.contains("insufficient", ignoreCase = true) || s.message.contains("unable", ignoreCase = true)) Coral else Secondary)
                IconButton(onClick = vm::clearMessage) { Icon(Icons.Default.Close, strings.get(R.string.dismiss_message), modifier = Modifier.size(18.dp)) }
            }
            if (!s.active && s.meta?.recorded == true) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = vm::play, enabled = !s.busy) { Icon(if (s.playing) Icons.Default.Pause else Icons.Default.PlayArrow, if (s.playing) strings.get(R.string.pause_playback) else strings.get(R.string.play_recording)) }
                Slider(value = (s.cursor ?: 0.0).toFloat().coerceIn(0f, max(.001f, s.meta!!.duration.toFloat())), onValueChange = { vm.seek(it.toDouble()) }, valueRange = 0f..max(.001f, s.meta!!.duration.toFloat()), modifier = Modifier.weight(1f).semantics { contentDescription = strings.get(R.string.playback_position) })
                Text(formatTime(s.cursor ?: 0.0), fontSize = 12.sp, fontFamily = FontFamily.Monospace)
            }
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (s.active) Button(onClick = vm::stop, enabled = !s.stopping, colors = ButtonDefaults.buttonColors(containerColor = if (s.meta?.recorded == true) Coral else Accent, contentColor = if (s.meta?.recorded == true) Color.White else Back), shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp)) {
                    Icon(Icons.Default.Stop, null, modifier = Modifier.size(20.dp)); Spacer(Modifier.width(10.dp)); Text(if (s.stopping) strings.get(R.string.saving) else if (s.meta?.recorded == true) strings.get(R.string.stop_recording) else strings.get(R.string.stop_analysis))
                } else {
                    OutlinedButton(onClick = { start(false) }, enabled = !s.busy, modifier = Modifier.weight(1f).heightIn(min = 52.dp), shape = RoundedCornerShape(14.dp), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp)) { Text(strings.get(R.string.analyze_only)) }
                    Button(onClick = { start(true) }, enabled = !s.busy, modifier = Modifier.weight(1f).heightIn(min = 52.dp), shape = RoundedCornerShape(14.dp), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp)) { Text(strings.get(R.string.start_recording)) }
                    if (s.meta != null) IconButton(onClick = { exports = true }, enabled = !s.busy, modifier = Modifier.height(52.dp)) { Icon(Icons.Default.IosShare, strings.get(R.string.export)) }
                }
            }
        }
    }
    if (exports) ModalBottomSheet(onDismissRequest = { exports = false }) {
        Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 24.dp)) {
            Text(strings.get(R.string.export), fontSize = 20.sp); Spacer(Modifier.height(12.dp))
            TextButton(onClick = { exports = false; export("wav", false) }, enabled = s.meta?.recorded == true) { Text(strings.get(R.string.save_wav_recording)) }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(whole, onCheckedChange = { whole = it }); Text(strings.get(R.string.include_the_full_session_in_the_image), fontSize = 14.sp)
            }
            TextButton(onClick = { exports = false; export("png", whole) }) { Text(strings.get(R.string.save_png_image)) }
            TextButton(onClick = { exports = false; export("session", false) }) { Text(strings.get(R.string.save_session_pitchsession)) }
        }
    }
    if (sessions) SessionSheet(s, vm) { sessions = false }
    if (settings) ModalBottomSheet(onDismissRequest = { settings = false }) {
        Column(Modifier.padding(24.dp).verticalScroll(rememberScrollState())) {
            Text(strings.get(R.string.input_settings), fontSize = 20.sp)
            TextButton(onClick = { vm.selectDevice(null) }) { Text(if (s.deviceId == null) strings.get(R.string.system_default_microphone_d1823d) else strings.get(R.string.system_default_microphone)) }
            remember { vm.devices() }.forEach { (id, label) -> TextButton(onClick = { vm.selectDevice(id) }) { Text((if (s.deviceId == id) "✓ " else "") + label) } }
            s.meta?.settings?.let { Text(strings.get(R.string.hz_echo_cancellation_noise_suppression_automatic_gain_control,
                it.source, it.sampleRate, strings.setting(it.echoCancellation), strings.setting(it.noiseSuppression), strings.setting(it.autoGainControl)), fontSize = 13.sp, color = Secondary) }
            Spacer(Modifier.height(16.dp)); Text(strings.get(R.string.audio_is_processed_on_your_device_locking_the_screen_or_switching_apps), color = Secondary, fontSize = 13.sp)
            Spacer(Modifier.height(12.dp)); Text(strings.get(R.string.quiet_recordings_are_boosted_during_playback_by_up_to_about_24_db_save), color = Secondary, fontSize = 13.sp)
            Spacer(Modifier.height(12.dp)); Text(strings.get(R.string.piano_salamander_grand_piano_alexander_holm_cc_by_3_0_pitch_detection_), fontSize = 12.sp, color = Secondary)
        }
    }
}

@Composable private fun TuningScale(cents: Double?, db: Float) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp)) {
        Canvas(Modifier.fillMaxWidth().height(16.dp)) {
            for (i in 0..20) drawLine(Secondary.copy(alpha = .55f), Offset(size.width * i / 20, if (i % 5 == 0) 0f else size.height * .4f), Offset(size.width * i / 20, size.height), 2f)
            cents?.let { val x = size.width * ((it.coerceIn(-50.0, 50.0) + 50) / 100).toFloat(); drawLine(Accent, Offset(x, 0f), Offset(x, size.height), 5f) }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { listOf("−50", "0", "+50").forEach { Text(it, fontSize = 10.sp, color = Secondary) } }
        LinearProgressIndicator(progress = { ((db + 60) / 60).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth().height(2.dp).padding(top = 1.dp), color = Accent.copy(alpha = .45f), trackColor = Back)
    }
}
@Composable private fun <T> Choice(values: List<T>, selected: T, label: (T) -> String, choose: (T) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { open = true }) { Text(label(selected)); Icon(Icons.Default.ExpandMore, null, Modifier.size(18.dp)) }
        DropdownMenu(open, onDismissRequest = { open = false }) { values.forEach { value -> DropdownMenuItem(text = { Text(label(value)) }, onClick = { open = false; choose(value) }) } }
    }
}
@Composable private fun PitchScroll(s: StudioState, vm: StudioViewModel) {
    val strings = LocalAppStrings.current
    Canvas(Modifier.width(48.dp).fillMaxHeight().semantics { contentDescription = strings.get(R.string.pitch_display_range) }
        .pointerInput(Unit) { detectDragGestures(onDragStart = { vm.pitchDrag(true) }, onDragEnd = { vm.pitchDrag(false) }, onDragCancel = { vm.pitchDrag(false) }) { change, _ ->
            change.consume(); vm.setPitchLow((84 - change.position.y / size.height * 63).roundToInt())
        } }) {
        val x = size.width / 2; val thumb = size.height * .24f; val y = (84 - s.display.pitchLow) / 63f * (size.height - thumb)
        drawLine(Secondary.copy(alpha = .15f), Offset(x, 16f), Offset(x, size.height - 16f), 5f)
        drawLine(Secondary.copy(alpha = .55f), Offset(x, y), Offset(x, y + thumb), 7f)
    }
}
@Composable private fun Overview(s: StudioState, vm: StudioViewModel) {
    val strings = LocalAppStrings.current
    val latest by rememberUpdatedState(s)
    Canvas(Modifier.fillMaxWidth().height(48.dp).background(Color(0xff192019), RoundedCornerShape(10.dp)).semantics { contentDescription = strings.get(R.string.full_session_waveform_navigator) }
        .pointerInput(Unit) { detectTapGestures { p -> vm.navigate(p.x / size.width * (latest.frozenAt ?: latest.meta?.duration ?: 0.0) - latest.range.span / 2) } }
        .pointerInput(Unit) { detectDragGestures { change, _ -> change.consume(); vm.navigate(change.position.x / size.width * (latest.frozenAt ?: latest.meta?.duration ?: 0.0) - latest.range.span / 2) } }) {
        val duration = max(1.0, s.frozenAt ?: s.meta?.duration ?: 0.0)
        for (e in s.overview) { val x = (e.time / duration * size.width).toFloat(); drawLine(Secondary, Offset(x, size.height / 2 - e.max * size.height * .43f), Offset(x, size.height / 2 - e.min * size.height * .43f), 2f) }
        val start = (s.range.start / duration * size.width).toFloat(); val end = (min(s.range.end, duration) / duration * size.width).toFloat()
        drawRect(Accent.copy(alpha = .08f), Offset(start, 0f), androidx.compose.ui.geometry.Size(max(0f, end - start), size.height))
    }
}
@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun SessionSheet(s: StudioState, vm: StudioViewModel, dismiss: () -> Unit) {
    val strings = LocalAppStrings.current
    var editing by remember { mutableStateOf<SessionMeta?>(null) }
    var deleting by remember { mutableStateOf<SessionMeta?>(null) }
    var name by remember { mutableStateOf("") }
    ModalBottomSheet(onDismissRequest = dismiss) {
        Column(Modifier.padding(horizontal = 20.dp).verticalScroll(rememberScrollState())) {
            Text(strings.get(R.string.saved_sessions), fontSize = 20.sp, modifier = Modifier.padding(bottom = 16.dp))
            if (s.sessions.isEmpty()) Text(strings.get(R.string.no_saved_sessions_yet), color = Secondary)
            s.sessions.forEach { session ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f).clickable { vm.load(session.id); dismiss() }.padding(vertical = 14.dp)) {
                        Text(session.name, maxLines = 2, fontSize = 14.sp)
                        Text("${formatTime(session.duration)} · ${if (session.recorded) strings.get(R.string.recording) else strings.get(R.string.analyze_only)}${if (session.interrupted) strings.get(R.string.interrupted) else ""}", color = Secondary, fontSize = 12.sp)
                    }
                    IconButton(onClick = { editing = session; name = session.name }) { Icon(Icons.Default.Edit, strings.get(R.string.rename)) }
                    IconButton(onClick = { deleting = session }) { Icon(Icons.Default.DeleteOutline, strings.get(R.string.delete_session)) }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
    editing?.let { item -> AlertDialog(onDismissRequest = { editing = null }, title = { Text(strings.get(R.string.rename)) }, text = { OutlinedTextField(name, onValueChange = { name = it.take(200) }) }, confirmButton = { TextButton(onClick = { vm.rename(item.id, name.trim()); editing = null }, enabled = name.isNotBlank()) { Text(strings.get(R.string.save)) } }, dismissButton = { TextButton(onClick = { editing = null }) { Text(strings.get(R.string.cancel)) } }) }
    deleting?.let { item -> AlertDialog(onDismissRequest = { deleting = null }, title = { Text(strings.get(R.string.delete_this_session)) }, text = { Text(strings.get(R.string.this_removes_the_recording_and_analysis_from_the_app_exported_files_ar, item.name)) }, confirmButton = { TextButton(onClick = { vm.delete(item.id); deleting = null }) { Text(strings.get(R.string.delete), color = Coral) } }, dismissButton = { TextButton(onClick = { deleting = null }) { Text(strings.get(R.string.cancel)) } }) }
}
