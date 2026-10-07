# 声见 Android

独立、离线的 Kotlin / Jetpack Compose App。支持 Android 10（API 29）及以上，compile/target SDK 36。网页版代码保持原状；Android 构建从仓库现有 `public/piano/salamander/` 打包采样，不需要启动网页服务。

运行截图使用合成测试数据：[主屏](docs/screenshots/main.png)、[钢琴](docs/screenshots/piano.png)、[声谱 PNG](docs/screenshots/export-spectrogram.png)。

## 安装与使用

测试包由 `:app:assembleDebug` 生成，位于 `app/build/outputs/apk/debug/app-debug.apk`。将 APK 传到手机，用文件管理器打开安装；如果系统询问，请为正在使用的文件管理器允许安装此 APK。它是开发签名的测试版本，不包含账号、网络服务或应用商店发布配置。

- 点击「仅分析」只保留分析数据；「开始录音」同时保存 48 kHz、单声道、16 位 PCM。每次最长 30 分钟，到时自动结束。
- 采集只在前台运行。锁屏、返回桌面或切换到其他 App 会结束并保存结果；返回后需主动开始。旋转屏幕不结束采集。采集中保持屏幕常亮，手动锁屏仍会停止。
- 四个页签共用时间范围。图表上左右拖动回看历史，上下拖动滚动页面；音高图右侧滑条调整两八度音域。实时有稳定音高时自动恢复跟随，冻结或回放时保留手动音域。
- 「10 秒／30 秒／1 分钟／5 分钟／整段」调整时间窗口。底部波形导航定位历史，「回到实时」恢复时间跟随。冻结只暂停显示，不暂停采集。
- 点击图表查看读数；停止后点击时间图可跳转回放。频谱是实时／最后快照；完整瞬时 FFT 不作为历史保存。声谱历史保留 512 个频段。
- 钢琴默认折叠，打开后有 A0–C8 的 88 键、八度定位和横向滚动；紫色为目标音，绿色为检测音。建议使用耳机，避免参考音被麦克风再次采集。
- 停止后录音和分析自动进入「更多 → 本机会话」，可重命名、打开和删除。导出按钮分别保存 WAV、PNG 或完整 `.pitchsession`；仅分析会话没有 WAV。
- WAV、PNG、会话文件都通过系统文件选择器导出。保存 PNG 可选择当前范围或整段概览；固定输出 1600 × 1240，包含音高图和所选分析图。音高页使用最近的分析页，默认声谱。

文件仅保存在设备。App 不申请网络权限或整盘存储权限，关闭系统备份／设备迁移；卸载会删除应用内会话，请先通过导出保留需要的文件。异常退出后只恢复最近完整落盘的部分，并标记中断。

音名检测面向单人说话或唱歌，不承担多人和声识别。电平与频谱强度来自数字信号，不是校准后的声压；真实麦克风效果和端到端延迟需要在具体手机上确认。

## 可重复构建

需要完整仓库、JDK 17 和 Android SDK。首次构建联网下载 Gradle / Maven 依赖，安装后的 APK 离线工作。仓库固定 Gradle 8.13（含 SHA-256 校验）、AGP 8.13.2、Kotlin 2.2.21 和 Compose BOM 2025.12.00。

```powershell
# SDK 中安装这些组件；sdkmanager 位于 Android SDK 的 cmdline-tools 下。
sdkmanager "platforms;android-36" "build-tools;35.0.0" "platform-tools"

# JAVA_HOME 指向 JDK 17；ANDROID_HOME 指向 SDK。
# 或在 android/local.properties 中设置 sdk.dir（此文件不提交）。
cd android
.\gradlew.bat :core:test :app:assembleDebug :app:lintDebug
```

macOS / Linux 使用 `./gradlew`。Android Studio 打开 `android/`，Gradle JDK 选择 17。输出为开发签名 APK，不需要创建私有发布密钥。Wrapper、版本配置和全部源代码都已提交；本机下载的 SDK、JDK、Gradle、模拟器及生成文件位于被忽略的 `.local/` 或构建缓存。

## 模块与文件

| 层 | 文件 | 责任 |
| --- | --- | --- |
| 音频输入 | `app/.../audio/AndroidPcmSource.kt`、`AudioEngine.kt` | AudioRecord 48 kHz PCM16；优先 UNPROCESSED，回退 VOICE_RECOGNITION；关闭可控制的音效并记录状态 |
| 采集管线 | `core/.../CapturePipeline.kt` | 独立采集、文件写入、分析线程；连续 PCM 写盘；分析过期帧可跳过，录音不拼接快照 |
| 算法 | `core/.../AnalysisProcessor.kt` | 4096 点 McLeod 音高；8192 点独立 FFT；电平与清晰度过滤；基频与频谱峰值分别计算 |
| 会话 | `core/.../SessionRepository.kt` | PCM、历史、包络分块持久化，样本时钟，检查点恢复，时间索引和多分辨率包络 |
| 文件互通 | `core/.../SessionCodec.kt` | `.pitchsession` v1 流式 JSON + 二进制导入／导出及严格验证 |
| 状态 | `app/.../StudioViewModel.kt` | StateFlow、可见数据、跟随／冻结、MediaPlayer 游标、文件操作 |
| 图表 | `app/.../ui/ChartRenderer.kt` | Canvas 屏幕与 PNG 共用绘制；两八度 25 条半音线、频谱／声谱／包络及毫秒快照 |
| 钢琴 | `app/.../audio/PianoEngine.kt`、`ui/PianoReference.kt` | 原生 MP3 解码、AudioTrack 混音；最多八个声部；采样按需缓存 |

`...` 分别代表 `src/main/java/app/pitchstudio/android` 或 `src/main/kotlin/app/pitchstudio/core`。主屏不持有整段 PCM；长期数据文件只读可见区间，整段包络使用多分辨率索引。

## 会话格式与本机恢复

兼容仓库根目录 README 描述的 `PITCHS01` v1 容器：8 字节标识、4 字节 JSON 长度、UTF-8 清单和四个二进制块。上限 256 MiB，清单最多 64 KiB；检查版本、块长度、WAV 头、样本数、有限数值、时间单调性及 30 分钟上限。失败的导入不替换当前会话。

`display.mobileView` 是可选扩展，保存 Android 的四页签选择；`display.view` 仍保存网页支持的 spectrum / spectrogram / waveform。网页忽略扩展字段，因此文件可以双向交换。没有快照、只有分析数据、空目标音均有兼容路径。

本机会话目录为 `files/sessions/<UUID>/`：`recording.wav`（仅录音）、`history.bin`、`envelopes.bin`、最后快照和 `meta.json`。每秒刷新文件并原子提交检查点；异常退出重启时截断到可验证的完整检查点。PCM 时长按实际写入样本计算；磁盘不足或写入速度跟不上时结束采集，保留已写部分，不伪装成完整录音。

## 自动化验证

```powershell
cd android
.\gradlew.bat :core:test :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug

# 将 SERIAL 换成 adb devices 中的目标设备；只操作测试设备。
adb -s SERIAL install -r app/build/outputs/apk/debug/app-debug.apk
adb -s SERIAL install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s SERIAL shell am instrument -w -e class app.pitchstudio.android.StudioTest,app.pitchstudio.android.PianoTest,app.pitchstudio.android.LayoutTest,app.pitchstudio.android.LifecycleTest,app.pitchstudio.android.DocumentPickerTest app.pitchstudio.android.test/androidx.test.runner.AndroidJUnitRunner

# 明确 opt-in：真实经过 30 分钟，不快进样本时钟。
adb -s SERIAL shell am instrument -w -e class app.pitchstudio.android.RecordingSoakTest -e soak true app.pitchstudio.android.test/androidx.test.runner.AndroidJUnitRunner
adb -s SERIAL pull /sdcard/Android/data/app.pitchstudio.android/files/soak-results ../.local/android-validation/
```

长测使用只存在于测试 APK 的实时节奏合成 PCM，经过正式采集／分析／写盘管线；不是对真人声音或物理麦克风的模拟结论。它校验精确 86,400,000 个样本、172,800,044 字节 WAV、自动停止、历史首尾和会话重新导入后的 WAV SHA-256。`StudioTest` 另行测试模拟器的原生 AudioRecord 启停。

网页互通测试直接调用现有网页的编码器／解码器，需要仓库 npm 依赖和 Node 24：

```powershell
# 在仓库根目录
node android/scripts/web-interop.mjs
.\android\gradlew.bat -p android :core:test
node android/scripts/web-interop.mjs android/core/build/interop/android.pitchsession
# 30 分钟测试结果被取回后
node android/scripts/check-soak.mjs .local/android-validation/soak-results/complete.pitchsession
```

测试源、实际结果、设备范围及尚待真机确认的项目见 [VALIDATION.md](VALIDATION.md)。

## 音色与许可证

钢琴沿用 Salamander Grand Piano / Alexander Holm 的 CC BY 3.0 采样。构建将原有 30 个 MP3、上游 README、署名及来源哈希一起打包；不下载网络音色。使用单力度层、相邻键最多一个半音的插值转调、淡入淡出和最多四秒的参考音，不模拟踏板或完整钢琴力度响应。

音高 McLeod 选择逻辑移植自 Pitchy，保留 MIT 许可证。详细来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

