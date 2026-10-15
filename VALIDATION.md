# 2026-10-15: English / Simplified Chinese language switching

- Added an English / 简体中文 selector to the header. English is the default; the choice persists locally, updates the document language and description, and works for the current session even when storage is blocked.
- Localized built-in controls, help, errors, accessibility labels, canvas text, and PNG captions. Switching preserves the microphone stream, current recording, frozen display, target note, and loaded session. Device labels and saved session names are kept as data.
- Production build and all 51 unit tests passed. Chrome/Edge regression: 34 passed and 6 opt-in long-running tests skipped. After completing the remaining labels and adding a Chinese PNG export check, all 4 language browser cases passed again. Artifacts: `.local/language-browser-full/` and `.local/language-browser-final/`.
- Visually checked English and Chinese mobile layouts and the Chinese PNG export. All 24 local links across the four READMEs resolve. Tests used synthetic audio; no new real-microphone or long-duration run was performed.

---

# 2026-10-15: English interface and bilingual documentation

- Translated built-in UI copy, accessibility labels, capture/import errors, chart labels, PNG exports, and new-session names into English. Set the document language to `en` and updated the page description and Windows launcher name.
- Split the project guide into English `README.md` and Simplified Chinese `README.zh-CN.md`, with reciprocal language links. Verified all 24 local links across the web and Android READMEs.
- `npm run build` and all 49 unit tests passed. Chrome/Edge browser regression: 30 passed, 6 opt-in long-running tests skipped. Artifacts: `.local/english-browser/`.
- Visual inspection found cramped mobile input controls and analysis tabs after translation. Adjusted wrapping and corrected the waveform amplitude label position. The focused Chrome layout/pitch checks passed (2 tests); the final idle/accessibility check passed again after narrowing piano-key selectors (1 test). Screenshots: `.local/english-layout/` and `.local/english-final/`.
- Web → Android → Web session interoperability passed with identical PCM, duration, history count, null target, and manual pitch range. Capture algorithms and file structure were not changed. No new real-microphone or long-duration acceptance run was performed.

---

# 2026-10-07：两八度音高视图与手动音域

- 音高图从 180 px 加高为 560 px，固定 24 个半音跨度，含端点共 25 条带音名的横线。桌面使用较宽的右侧图表，窄屏将图表放在读数下方；已检查两种布局和 1600 × 1240 PNG，半音标签及色尺可读。
- 采集时检测到有效音高自动跟随，手动调整结束后也会在下一帧有效音高恢复，无模式按钮。拖动中、静音或画面冻结时保留选定位置；回放时手动调整后保持音域。支持竖向滑块、上下按钮、画布拖动、滚轮和方向键。拖动不触发音频跳转，单击仍可跳转播放。
- 纵轴设置保存在完整会话中；旧文件缺少新增字段时使用默认值。新增加的有效音高索引按时间二分查询，不逐帧扫描长时间静音。
- TypeScript / Vite 构建通过，49 项单元测试通过。新增 Chrome / Edge 音域交互测试共 2 项通过，原有录音、PNG、导入导出、冻结、权限、断开及页面回归共 22 项通过。
- 移除模式按钮后再次通过 49 项单元测试、生产构建及 Chrome / Edge 的 2 项音域回归：手动调完后实时音高恢复跟随，静音与冻结保持位置，回放和重新导入时保留手动音域。最新截图与断言在 `.local/auto-follow-recheck/`。
- 验证使用合成滑音与已知音高，实际经过浏览器 Web Audio；没有做新的真人麦克风测试或重跑长时间录制。截图与新交互证据在 `.local/pitch-viewport/`，原有功能回归及 PNG 在 `.local/pitch-regression/`。

---

# 2026-10-07：精简页面与 88 键采样钢琴

- 删除顶部介绍区与底部品牌标语，保留顶部品牌、指南及采集状态。已查看 1440 px 桌面与 390 px 窄屏截图；键盘在窄屏内横向滚动，页面无横向溢出。
- 标准 A0–C8 共 88 键，52 白键、36 黑键。Salamander Grand Piano 的 30 段 MP3 共 2,012,677 字节，原作者 Alexander Holm，CC BY 3.0；上游版本与文件 SHA-256 记录在 `public/piano/salamander/source.json`。
- TypeScript / Vite 生产构建通过；45 项单元测试通过，覆盖采样文件完整性、所有琴键映射及 A0 / C8 目标音的会话往返。
- 原有 22 项 Chrome / Edge 交互回归通过；新增 6 项钢琴浏览器测试通过。检查真实 MP3 解码、非静音 PCM、实际 AudioBufferSource 启动、相邻音移调、缓存复用、快速换键取消旧请求，以及加载错误后的重试。没有把测试音源或正弦波代替钢琴采样。
- 首轮钢琴端点测试使用了 ASCII `#`，与界面的音乐符号 `♯` 不符，两个浏览器的定位断言因此超时。修正测试选择器后，两项均通过；没有修改产品来迎合测试。生产回归产物在 `.local/piano-acceptance/`，修正后通过的开发模式端点复测在 `.local/piano-key-recheck/`。
- 生产测试完成后，其预览进程在 Windows 清理阶段没有自动退出；已确认进程归属并结束本轮创建的 4173 预览服务，保留用户原有的 5173 开发服务。

音色采用单力度网页采样子集，保留真实钢琴的音色与自然衰减；不包含完整乐器的力度层、踏板和共鸣模拟。已验证音频数据与浏览器播放调用，未进行真人主观试听或真实麦克风验收。本轮不涉及录音采集变更，没有重跑 30 分钟录制；此前记录见下。

---

# 2026-10-06：长时间轴与录音会话

环境：Windows，Chrome / Edge，Playwright headless。音源为测试注入的 220 Hz 基频、更强的 440 Hz 泛音、滑音与静音，连接真实 Web Audio / AudioWorklet；没有使用真人麦克风。

| 检查                        | 当前结果                                         |
| --------------------------- | ------------------------------------------------ |
| TypeScript 与 Vite 生产构建 | 通过                                             |
| 单元测试                    | 37 项通过                                        |
| 最终生产构建交互回归        | Chrome 11 项、Edge 11 项通过                     |
| 30 分钟连续录制             | 通过：真实经过 1810.663 秒，录制音频精确 1800 秒 |

开发模式完整回归也通过 Chrome 11 项、Edge 11 项（产物位于 `.local/dev-final/`）。

## 30 分钟录制实测

- 实际运行 1810.663 秒，达到 86,400,000 个样本后自动结束，音频精确 1800 秒。
- WAV 大小 172,800,044 字节，完整会话 204,947,877 字节；54,542 帧分析历史、180,000 个 10 ms 包络点，开头仍可访问。
- 自动停止前每 30 秒观察约 30.27–30.39 次分析／秒；GC 后 JavaScript 堆约 5.2–19.4 MiB、数组缓冲区约 10.4–38.7 MiB。保存完整历史意味着内存随时间增长。这些指标不包含浏览器内部 Blob、媒体解码器和所有进程内存，也不代表跨设备保证。
- 自动结束后释放全部测试音频上下文；WAV 与会话内音频字节一致；重新打开、整段 PNG 和第 1700 秒之后播放成功；无浏览器运行错误。
- 长测试运行期间，后续完善了冻结截点、查询边界及开发服务配置，连续 PCM 采集与 WAV 生成实现未改变。最终构建另外在 Chrome 和 Edge 打开这份长会话，验证第 603 秒附近的图表定位、第 1790 秒之后播放、整段图像与零麦克风请求。
- 两个浏览器再次导出的 WAV SHA-256 均与原文件一致：`c8145cbd538cab4677024d9ab01083ca2195e472f0347067aabaf1573608b19a`。

录制测试的断言与产物验证通过后，原启动器在清理预览服务时未自行退出；已手动结束该测试启动器并确认 5173 / 4173 均无监听。该启动器最终为中断退出状态，录制通过证据来自单项通过记录、result.json 和独立的最终会话恢复测试。

原始文件、每 30 秒指标及结果在 `.local/recording-soak/`；最终构建的跨浏览器长会话验证在 `.local/final-long-reopen/`。这些测试生成物均被 Git 忽略。

本轮自动化覆盖：

- 10 秒后访问开头、范围切换、手动定位、停止后跳转播放；导入后不再次请求麦克风。
- 48 kHz / 单声道 / PCM16 WAV 文件头与长度；已知静音区间；从 WAV 相同时间位置提取样本重新识别音高，与历史音高比较（误差小于 8 音分，包含滑音窗口差异）。稳定纯音的 5 音分目标仍由原有信号测试覆盖。
- 完整会话往返：录音、历史、波形包络和实时快照二进制块一致；损坏文件不会替换当前结果；仅分析会话可重新打开。
- 未保存提示的保存、放弃、取消，Esc 取消导入替换；原有键盘页签、钢琴与窄屏检查。
- 停止刷新最后一段 PCM、设备断开后的 WAV、反复启停和权限错误恢复。
- 冻结跨页签与窗口大小调整；测试专用的分析调度暂停期间 PCM 继续收集，历史保留缺口。
- 可见范围与整段 PNG 均为 1600 × 930，已检查截图的坐标、刻度、色尺和滑音／静音对应位置。

最终生产回归产物在 `.local/production-acceptance/`。开发阶段发现 Vite 扫描／监听大量本地测试 HTML 与 trace 产物，导致加载变慢并干扰测试。已将依赖入口固定为 index.html，并排除 .local、test-results、playwright-report 的监听；失败过程记录不作为最终通过证据。开发测试中主线程阻塞的效果不稳定，因此中断验收使用测试专用的定时回调暂停，以实际音频时钟等待超过 1 秒；没有伪造 PCM、FFT 或时间戳。

## 仍需真人验证

真人长音、滑音、元音变化、麦克风硬件与设备音效、端到端延迟尚未实测。合成音验收不能替代这些项目。

---

# 2026-10-04：初版验证记录

日期：2026-10-04。环境：Windows，本机 Node.js 24.15.0，已安装的 Chrome 与 Edge，Playwright headless。

| 检查                            | 结果                                                                |
| ------------------------------- | ------------------------------------------------------------------- |
| TypeScript 检查与 Vite 生产构建 | 通过                                                                |
| 信号分析及曲线范围单元测试      | 24 项通过                                                           |
| 浏览器交互、错误处理及窄屏检查  | Chrome 8 项、Edge 8 项通过                                          |
| 持续运行                        | Chrome、Edge 分别超过 600 秒，通过                                  |
| 生产构建冒烟检查                | 页面、61 个琴键、目标选择、波形控件正常；无运行错误、无外部资源请求 |

## 持续运行实测

合成的 220 Hz 基频与更强的 440 Hz 泛音接入真实 Web Audio 处理链路；每分钟切换分析图表，每 30 秒检查音高、采样次数及 GC 后的内存。

- 两个浏览器均约 30.3 次／秒持续分析。
- 观察到的 JavaScript 堆约 16.1–17.0 MB，缓冲区约 18.5–18.6 MB，未出现持续累积。
- 运行期间麦克风请求次数保持为 1；停止后流关闭、音频上下文关闭，采样计数停止增长。
- 以上范围来自本次测试控制台采样日志，是近似值，并非跨设备性能保证。

持续运行测试完成后，只调整了音高曲线的纵轴范围计算，让整段滑音及参考音完整可见；已重跑上述 24 项单元测试和 16 项浏览器交互测试。持续测试未在这次图表范围调整后重新计时 10 分钟。采集、FFT、音高识别与历史缓冲实现未改变。

## 尚需真人确认

尚未使用用户的真实麦克风完成真人长音、滑音和不同元音的验收，也未测量真实采集到显示的端到端延迟。麦克风硬件、系统音效和浏览器音频处理可能影响结果。

用 Chrome 或 Edge 打开 <http://127.0.0.1:5173/>，允许麦克风后测试：唱长音查看读数稳定性；缓慢滑音查看连续轨迹；保持音高改变元音观察泛音变化；戴耳机点击琴键并跟唱；最后停止，确认浏览器麦克风占用指示关闭。

本地源代码和构建产物已生成。网页未部署到公网；Git 提交与 GitHub 同步状态以仓库记录为准。
