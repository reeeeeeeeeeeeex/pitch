# Android 验证记录

日期：2026-10-07。目标手机由用户确认为一加 13 / Android 15；本轮 adb 只连接本项目模拟器，没有连接真人使用的手机。

## 构建与安装包

- Kotlin / Compose 原生工程，Android 10+（min 29），compile/target 36，JDK 17。
- 仓库 Gradle Wrapper 8.13 已实际下载分发包并运行；`:core:test`、`:app:assembleDebug`、`:app:assembleDebugAndroidTest`、`:app:lintDebug` 成功。
- Lint：0 errors，13 warnings，主要是可升级依赖、KTX 建议，以及旧 Android 备份声明提示；`allowBackup=false` 已覆盖旧系统，Android 12+ 额外排除云备份和设备迁移。
- APK v2 签名验证成功；包名 `app.pitchstudio.android`，versionName 1.0.0 / versionCode 1。包含 arm64-v8a（目标手机）、armeabi-v7a、x86、x86_64 的依赖库；本轮运行测试使用 x86_64。
- APK 申请麦克风权限；没有 INTERNET 或整个存储空间权限。30 个钢琴 MP3、署名、来源清单和 Pitchy MIT 许可证均实际包含在 APK 中。
- 最终 APK SHA-256：`7F5D75173089EF56B3F806BF38993F84F7E8EBDAF7EA573BB0C4F7845292A887`。

## 已执行测试

| 范围 | 结果与实际覆盖 |
| --- | --- |
| JVM 核心 | 13 项通过：110/220/440/880 Hz 音高误差小于 5 音分；220 Hz 基频与更强 440 Hz 泛音；静音／噪声；时间及音域定位；最后部分 PCM；会话往返；损坏版本、长度、超限时间、NaN；检查点恢复；包络极值；静音和分析缺口；并发显示操作不回退样本计数；模拟磁盘不足 |
| Android 16 / API 36 | 最终主要交互 7 项通过：`StudioTest` 3 项，`PianoTest`、`LayoutTest`、`LifecycleTest`、`DocumentPickerTest` 各 1 项 |
| Android 15 / API 35 | 8 个独立短程用例最终通过：StudioTest 4 项（16.905 秒），另有钢琴、布局、锁屏和文件选择器各 1 项；长时间录制也已通过 |
| 窄屏与大字号 | 360 × 640 dp、1.5 倍字体；20 秒合成会话、历史开头、缩放、回放、三类 PNG、钢琴入口；真实竖向滑动能滚动页面，音域通过右侧滑条调整 |
| 横屏 | 914 × 411 dp；允许上下滚动查看完整图表，保留底部操作；实际旋转时采集继续且 ViewModel／会话不变 |
| 锁屏／后台 | 在设备测试中模拟离开前台、系统休眠键；停止、落盘、释放采集，返回不自动开始 |
| 系统文件选择器 | 真正打开系统保存与导入界面后返回取消；原会话保留，采集不启动，busy 状态解除 |
| 权限拒绝 | 从模拟器撤销 RECORD_AUDIO，点开始录音，在系统弹窗选择 Don't allow；明确提示未授予权限，原会话保留，没有结束录音按钮 |
| 实际进程中断 | 在模拟器持续合成录音时执行 `am force-stop`，重启 App；恢复 1,056,000 个完整落盘样本，WAV 长度匹配、历史可读、标为已中断；未声称恢复缓冲中的样本 |
| 网页互通 | 使用网页原有 TypeScript 编码器生成 1 秒测试文件，原生导入／导出，再使用网页原有解码器校验；PCM 字节、时长、30 个历史帧、空目标音与手动音域一致 |
| PNG | 人工查看默认、窄屏、横屏以及 1600 × 1240 的导出结果；音高逐半音标线、时间轴、滑音轨迹、静音间隔、频率／振幅单位和声谱色尺可读 |

设备短测使用原生模拟器 AudioRecord（静音输入）确认设备接口可创建及释放；音高、声谱与 WAV 内容使用合成信号验证。钢琴测试确认 MP3 解码得到非零 PCM、原生 AudioTrack 写入数据，A0 / C4 / C8 和相邻半音缓存路径可用；没有把模拟器无扬声器输出视为听感验收。

最终 API 35 复测曾出现手动音域被恢复为旧会话数值的断言：测试直接注入合成采集，绕过了界面的 busy 保护，没有等待初次恢复结束。测试现先等待恢复并核对新会话 ID；另加恢复期间禁止开始采集的断言，避免将旧会话当成本次结果。

修正后 StudioTest 的 4 项复测通过，且加载中启动采集确实被界面状态保护阻止；本次测试修正没有改变生产音频或文件实现。

## 真实经过 30 分钟的长测

**通过。** 实际计时 1,801,934 ms（约 30 分 1.9 秒），原生测试含文件导出／重新导入总耗时 1,826.291 秒。

- 自动结束原因：已达到 30 分钟。录音恰好 86,400,000 个样本，48 kHz、单声道、PCM16；WAV 为 172,800,044 字节。
- 历史 44,776 帧，最后一帧时间为 1,800.0 秒；平均 24.88 帧／秒（本实现 20 ms 读取块，分析通常每两块提交，繁忙时跳过过期帧）。首尾历史都可重新打开。
- 完整会话 199,713,342 字节；原生导出／导入后的 WAV SHA-256 一致。网页原有解码器能打开整段文件，同一校验和为 `934279c462c7bd7c334698eaecffef2e21639171b3ea29ed731e71b1b119eb22`。
- 网页 Pitchy 从 WAV 的 5 / 45 / 75 / 105 / 135 / 165 / 225 / 1785 秒处重新检测，分别与原生历史及已知音调一致、误差均小于 5 音分；190 和 490 秒片段为零样本且历史没有稳定音高。
- 60 次每 30 秒采样的记录中，Java 堆最高 33.63 MiB，PSS 最高 146.04 MiB。数值仅覆盖采集期间，不包含结束后导入时的额外缓存，也不代表真机内存上界；没有发生 OOM 或提前停止。
- 原始 [指标 CSV](docs/validation/soak-api35-metrics.csv)、[原生断言结果](docs/validation/soak-api35-result.txt)、[网页解码与音高核对](docs/validation/soak-web-check.json) 已保存。大体积 WAV 和会话在 `.local/android-validation/soak-results/`。

测试 APK 在 Android 15 / API 35 模拟器运行，输入为按真实时钟每 20 ms 供给的合成 PCM。使用正式采集、分析、历史、包络与文件管线；四种固定音调、较强二次泛音、定期间隔静音，每 30 秒切换一次图表。不是把 30 分钟样本在几秒内灌完，也不是物理麦克风的 30 分钟验收。

长测开始后只调整了界面的竖向手势、配色、大字号按钮与 PNG 单位；录制／分析／会话核心保持相同。长测 APK SHA-256：`5D0B20005EA112112218FEA31C078AA5208F9641927E2848925DADA75A95BF1D`。最终界面版本另行完成构建和短程回归。

## 证据与复现

- 自动化命令与结构见 [README.md](README.md)。短程测试源位于 `app/src/androidTest/java/app/pitchstudio/android/`，核心测试位于 `core/src/test/kotlin/app/pitchstudio/core/`。
- 本机原始日志、测试截图、权限 UI XML 和导出 PNG 在仓库 `.local/android-validation/`，不提交大文件。
- 构建报告：`core/build/reports/tests/test/index.html`、`app/build/reports/lint-results-debug.html`。
- 异常恢复测试需先以 `-e crashFixture true -e class app.pitchstudio.android.RecoveryDeviceTest#prepareCrashFixture` 运行；等待外部文件 `crash-ready.txt`，用 adb 结束该测试 App，然后运行 `RecoveryDeviceTest#appRestartRecoversCheckpointAfterForcedTermination`。准备阶段的进程被终止是预期动作；通过依据是重启后的恢复断言。
- `.pitchsession` 互通脚本直接加载当前网页源码；`scripts/check-soak.mjs` 会使用网页 Pitchy 从长测 WAV 抽取片段，与对应历史核对音调／静音、时长和校验和。

## 尚未完成的真机验收

一加 13 / Android 15 未连接，因此真人唱歌、元音变化、实际采集音效、扬声器／耳机听感与端到端延迟尚未验证。真实来电打断、物理设备断开、低存储设备现场表现以及该手机连续 30 分钟运行也仍需真机确认。代码路径、模拟输入和模拟器检查不能替代这些项目。

Android 10–14 的运行行为未逐版本实测，当前 APK 的 minSdk 为 29；已运行的系统是 Android 15 和 Android 16。应用商店发布、后台录音、云同步、任意音频文件重新分析均不在此版本范围内。

