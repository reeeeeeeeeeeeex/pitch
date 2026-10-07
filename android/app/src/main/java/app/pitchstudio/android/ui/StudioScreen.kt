package app.pitchstudio.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
    val s by vm.state.collectAsStateWithLifecycle()
    var menu by remember { mutableStateOf(false) }
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
                Text(if (s.active) { if (s.meta?.recorded == true) "录音中" else "分析中" } else if (s.meta != null) "已保留" else "准备就绪", color = Secondary, fontSize = 14.sp)
                Spacer(Modifier.weight(1f))
                Text(formatTime(s.meta?.duration ?: 0.0), fontFamily = FontFamily.Monospace, color = Secondary)
                Box {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "更多") }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(text = { Text("本机会话") }, enabled = !s.active && !s.busy, onClick = { menu = false; sessions = true })
                        DropdownMenuItem(text = { Text("导入会话") }, enabled = !s.active && !s.busy, onClick = { menu = false; importFile() })
                        DropdownMenuItem(text = { Text("采集设置") }, enabled = !s.active, onClick = { menu = false; settings = true })
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
                            Text(pitch?.let { "%.1f Hz".format(it.hz) } ?: "未检测到稳定音高", color = Secondary, fontSize = 14.sp)
                            Text(cents?.let { "%+.0f 音分".format(it) } ?: "等待声音", color = Accent, fontSize = 14.sp)
                        }
                    }
                    TuningScale(cents, s.frame?.rmsDb ?: -160f)
                    Row(Modifier.fillMaxWidth()) {
                        listOf(View.PITCH to "音高", View.SPECTROGRAM to "声谱", View.WAVEFORM to "波形", View.SPECTRUM to "频谱").forEach { (view, title) ->
                            Column(Modifier.weight(1f).clickable { vm.view(view) }.heightIn(min = 48.dp).padding(top = 8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Bottom) {
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
                            .semantics { contentDescription = if (s.view == View.PITCH) "音高图，${noteName(s.display.pitchLow)} 至 ${noteName(s.display.pitchLow + 24)}，25 条半音线" else "${s.view.name}分析图" }
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
                    s.probe?.let { Text(it, color = Secondary, fontSize = 11.sp, modifier = Modifier.padding(start = 12.dp, top = 4.dp)) }
                    if (s.view == View.WAVEFORM) {
                        TextButton(onClick = { detail = !detail }) { Text(if (detail) "收起振动细节" else "振动细节 · 毫秒") }
                        if (detail) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Choice(listOf(5, 10, 20, 50), s.display.milliseconds, { "$it ms" }) { vm.details(ms = it) }
                                Choice(listOf(1, 2, 4, 8), s.display.gain, { "×$it" }) { vm.details(gain = it) }
                                Text("实时／最后快照", fontSize = 11.sp, color = Secondary)
                            }
                            Canvas(Modifier.fillMaxWidth().height(130.dp)) { drawIntoCanvas { ChartRenderer.detail(it.nativeCanvas, size.width, size.height, s, with(density) { 11.sp.toPx() }) } }
                        }
                    }
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                        Choice(listOf(10, 30, 60, 300, 0), s.display.windowSeconds, { when (it) { 0 -> "整段"; 60 -> "1 分钟"; 300 -> "5 分钟"; else -> "$it 秒" } }, vm::window)
                        Spacer(Modifier.weight(1f))
                        if (!s.following) TextButton(onClick = vm::live) { Text("回到实时", fontSize = 12.sp) }
                        IconButton(onClick = vm::freeze, enabled = s.meta != null) { Icon(if (s.frozen) Icons.Default.PlayArrow else Icons.Default.AcUnit, if (s.frozen) "恢复画面" else "冻结画面", tint = if (s.frozen) Accent else Secondary) }
                    }
                    Overview(s, vm)
                    piano?.invoke()
                    Spacer(Modifier.height(8.dp))
                }
            }
            if (s.message.isNotBlank()) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(s.message, modifier = Modifier.weight(1f), fontSize = 12.sp, color = if (s.message.contains("失败") || s.message.contains("不足")) Coral else Secondary)
                IconButton(onClick = vm::clearMessage) { Icon(Icons.Default.Close, "关闭提示", modifier = Modifier.size(18.dp)) }
            }
            if (!s.active && s.meta?.recorded == true) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = vm::play, enabled = !s.busy) { Icon(if (s.playing) Icons.Default.Pause else Icons.Default.PlayArrow, if (s.playing) "暂停回放" else "播放录音") }
                Slider(value = (s.cursor ?: 0.0).toFloat().coerceIn(0f, max(.001f, s.meta!!.duration.toFloat())), onValueChange = { vm.seek(it.toDouble()) }, valueRange = 0f..max(.001f, s.meta!!.duration.toFloat()), modifier = Modifier.weight(1f).semantics { contentDescription = "回放位置" })
                Text(formatTime(s.cursor ?: 0.0), fontSize = 12.sp, fontFamily = FontFamily.Monospace)
            }
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (s.active) Button(onClick = vm::stop, enabled = !s.stopping, colors = ButtonDefaults.buttonColors(containerColor = if (s.meta?.recorded == true) Coral else Accent, contentColor = if (s.meta?.recorded == true) Color.White else Back), shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp)) {
                    Icon(Icons.Default.Stop, null, modifier = Modifier.size(20.dp)); Spacer(Modifier.width(10.dp)); Text(if (s.stopping) "正在保存…" else if (s.meta?.recorded == true) "结束录音" else "结束分析")
                } else {
                    OutlinedButton(onClick = { start(false) }, enabled = !s.busy, modifier = Modifier.weight(1f).heightIn(min = 52.dp), shape = RoundedCornerShape(14.dp), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp)) { Text("仅分析") }
                    Button(onClick = { start(true) }, enabled = !s.busy, modifier = Modifier.weight(1f).heightIn(min = 52.dp), shape = RoundedCornerShape(14.dp), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp)) { Text("开始录音") }
                    if (s.meta != null) IconButton(onClick = { exports = true }, enabled = !s.busy, modifier = Modifier.height(52.dp)) { Icon(Icons.Default.IosShare, "导出") }
                }
            }
        }
    }
    if (exports) ModalBottomSheet(onDismissRequest = { exports = false }) {
        Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 24.dp)) {
            Text("导出", fontSize = 20.sp); Spacer(Modifier.height(12.dp))
            TextButton(onClick = { exports = false; export("wav", false) }, enabled = s.meta?.recorded == true) { Text("保存 WAV 录音") }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(whole, onCheckedChange = { whole = it }); Text("图像使用整段概览", fontSize = 14.sp)
            }
            TextButton(onClick = { exports = false; export("png", whole) }) { Text("保存 PNG 图像") }
            TextButton(onClick = { exports = false; export("session", false) }) { Text("保存完整会话 .pitchsession") }
        }
    }
    if (sessions) SessionSheet(s, vm) { sessions = false }
    if (settings) ModalBottomSheet(onDismissRequest = { settings = false }) {
        Column(Modifier.padding(24.dp).verticalScroll(rememberScrollState())) {
            Text("采集设置", fontSize = 20.sp)
            TextButton(onClick = { vm.selectDevice(null) }) { Text(if (s.deviceId == null) "✓ 系统默认麦克风" else "系统默认麦克风") }
            remember { vm.devices() }.forEach { (id, label) -> TextButton(onClick = { vm.selectDevice(id) }) { Text((if (s.deviceId == id) "✓ " else "") + label) } }
            s.meta?.settings?.let { Text("${it.source} · ${it.sampleRate} Hz\n回声消除：${it.echoCancellation ?: "未知"}\n降噪：${it.noiseSuppression ?: "未知"}\n自动增益：${it.autoGainControl ?: "未知"}", fontSize = 13.sp, color = Secondary) }
            Spacer(Modifier.height(16.dp)); Text("声音在本机处理。锁屏或切到其他 App 会结束采集并保留结果。每次最长 30 分钟。", color = Secondary, fontSize = 13.sp)
            Spacer(Modifier.height(12.dp)); Text("钢琴：Salamander Grand Piano / Alexander Holm / CC BY 3.0\n音高算法：Pitchy / Ian Johnson / MIT", fontSize = 12.sp, color = Secondary)
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
    Canvas(Modifier.width(48.dp).fillMaxHeight().semantics { contentDescription = "音高显示音域" }
        .pointerInput(Unit) { detectDragGestures(onDragStart = { vm.pitchDrag(true) }, onDragEnd = { vm.pitchDrag(false) }, onDragCancel = { vm.pitchDrag(false) }) { change, _ ->
            change.consume(); vm.setPitchLow((84 - change.position.y / size.height * 63).roundToInt())
        } }) {
        val x = size.width / 2; val thumb = size.height * .24f; val y = (84 - s.display.pitchLow) / 63f * (size.height - thumb)
        drawLine(Secondary.copy(alpha = .15f), Offset(x, 16f), Offset(x, size.height - 16f), 5f)
        drawLine(Secondary.copy(alpha = .55f), Offset(x, y), Offset(x, y + thumb), 7f)
    }
}
@Composable private fun Overview(s: StudioState, vm: StudioViewModel) {
    val latest by rememberUpdatedState(s)
    Canvas(Modifier.fillMaxWidth().height(48.dp).background(Color(0xff192019), RoundedCornerShape(10.dp)).semantics { contentDescription = "整段波形导航" }
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
    var editing by remember { mutableStateOf<SessionMeta?>(null) }
    var deleting by remember { mutableStateOf<SessionMeta?>(null) }
    var name by remember { mutableStateOf("") }
    ModalBottomSheet(onDismissRequest = dismiss) {
        Column(Modifier.padding(horizontal = 20.dp).verticalScroll(rememberScrollState())) {
            Text("本机会话", fontSize = 20.sp, modifier = Modifier.padding(bottom = 16.dp))
            if (s.sessions.isEmpty()) Text("还没有保存的会话", color = Secondary)
            s.sessions.forEach { session ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f).clickable { vm.load(session.id); dismiss() }.padding(vertical = 14.dp)) {
                        Text(session.name, maxLines = 2, fontSize = 14.sp)
                        Text("${formatTime(session.duration)} · ${if (session.recorded) "录音" else "仅分析"}${if (session.interrupted) " · 已中断" else ""}", color = Secondary, fontSize = 12.sp)
                    }
                    IconButton(onClick = { editing = session; name = session.name }) { Icon(Icons.Default.Edit, "重命名") }
                    IconButton(onClick = { deleting = session }) { Icon(Icons.Default.DeleteOutline, "删除会话") }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
    editing?.let { item -> AlertDialog(onDismissRequest = { editing = null }, title = { Text("重命名") }, text = { OutlinedTextField(name, onValueChange = { name = it.take(200) }) }, confirmButton = { TextButton(onClick = { vm.rename(item.id, name.trim()); editing = null }, enabled = name.isNotBlank()) { Text("保存") } }, dismissButton = { TextButton(onClick = { editing = null }) { Text("取消") } }) }
    deleting?.let { item -> AlertDialog(onDismissRequest = { deleting = null }, title = { Text("删除此会话？") }, text = { Text("${item.name}\n应用内录音和分析将一并删除。已导出的文件不受影响。") }, confirmButton = { TextButton(onClick = { vm.delete(item.id); deleting = null }) { Text("删除", color = Coral) } }, dismissButton = { TextButton(onClick = { deleting = null }) { Text("取消") } }) }
}
