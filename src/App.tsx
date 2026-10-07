import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Activity,
  AudioLines,
  ChartNoAxesCombined,
  ChevronDown,
  CircleHelp,
  Headphones,
  Mic,
  Pause,
  Play,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Waves,
  X,
} from 'lucide-react';
import { AudioSession } from './audio/session';
import { ReferencePiano } from './audio/piano';
import { FFT_SIZE, noteName, spectralPeaks, type AnalysisFrame } from './audio/analysis';
import { AnalysisChart, targetDeviation, type View } from './components/Charts';
import { Piano } from './components/Piano';
import { TimeChart, Navigator, saveImage } from './components/Timeline';
import { formatTime, timeWindow, type SavedDisplay } from './audio/history';
import { encodeSession, decodeSession, downloadBlob } from './audio/archive';

const VIEWS = [
  {
    id: 'spectrum' as const,
    name: '频谱图',
    icon: ChartNoAxesCombined,
    subtitle: '看见声音里的每一种频率',
    helper: '横轴：频率 · 纵轴：相对强度',
  },
  {
    id: 'spectrogram' as const,
    name: '声谱图',
    icon: AudioLines,
    subtitle: '看见频率随时间流动',
    helper: '横轴：时间 · 纵轴：频率 · 颜色：强度',
  },
  {
    id: 'waveform' as const,
    name: '波形图',
    icon: Waves,
    subtitle: '看见声音每一次真实的振动',
    helper: '横轴：时间 · 纵轴：采样振幅',
  },
];

interface FrozenView {
  frames: AnalysisFrame[];
  frame: AnalysisFrame;
  endTime: number;
}
const settingLabel = (value: boolean | string | undefined) =>
  value === undefined ? '未报告' : typeof value === 'string' ? value : value ? '已启用' : '已关闭';

export default function App() {
  const [session] = useState(() => new AudioSession());
  const [piano] = useState(() => new ReferencePiano());
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [view, setView] = useState<View>('spectrum');
  const [target, setTarget] = useState<number | null>(null);
  const [frozen, setFrozen] = useState<FrozenView | null>(null);
  const [milliseconds, setMilliseconds] = useState(20);
  const [gain, setGain] = useState(1);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [playbackError, setPlaybackError] = useState('');
  const [windowSeconds, setWindowSeconds] = useState(30);
  const [following, setFollowing] = useState(true);
  const [viewStart, setViewStart] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [fileError, setFileError] = useState('');
  const [fileBusy, setFileBusy] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [imageScope, setImageScope] = useState('visible');
  const audioRef = useRef<HTMLAudioElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const data = snapshot.data;
  const active = ['running', 'requesting', 'stopping'].includes(snapshot.status);
  const range = timeWindow(frozen?.endTime ?? data.duration, windowSeconds, following, viewStart);
  const display: SavedDisplay = {
    view,
    windowSeconds,
    target,
    milliseconds,
    gain,
  };
  const navigate = (start: number) => {
    setFollowing(false);
    setViewStart(Math.max(0, start));
  };
  const seek = (time: number) => {
    if (active || !audioRef.current) return;
    const value = Math.max(0, Math.min(data.duration, time));
    audioRef.current.currentTime = value;
    setCursor(value);
  };
  const saveSession = () => {
    downloadBlob(encodeSession(data, display), data.name + '.pitchsession');
    session.markSaved();
  };
  const protect = (action: () => void) => {
    if (snapshot.dirty) setPending(() => action);
    else action();
  };
  useEffect(() => {
    if (!data.wav) {
      setAudioUrl('');
      return;
    }
    const url = URL.createObjectURL(data.wav);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [data.wav]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (session.getSnapshot().dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [session]);
  const importSession = async (file: File) => {
    setFileBusy(true);
    setFileError('');
    try {
      const imported = await decodeSession(file);
      protect(() => {
        audioRef.current?.pause();
        session.load(imported.data);
        setView(imported.display.view);
        setTarget(imported.display.target);
        setWindowSeconds(imported.display.windowSeconds);
        setMilliseconds(imported.display.milliseconds);
        setGain(imported.display.gain);
        setFrozen(null);
        setFollowing(false);
        setViewStart(0);
        setCursor(null);
      });
    } catch (error) {
      setFileError(error instanceof Error ? error.message : '文件无法打开');
    } finally {
      setFileBusy(false);
    }
  };
  const exportImage = async () => {
    setFileError('');
    try {
      await saveImage(
        data,
        imageScope === 'whole' && view !== 'spectrum'
          ? { start: 0, end: Math.max(1, data.duration) }
          : range,
        view,
        target,
        document.querySelector('#analysis-content canvas'),
        imageScope === 'whole' && view !== 'spectrum'
          ? data.duration
          : (frozen?.endTime ?? data.duration),
      );
    } catch {
      setFileError('图像保存失败，请重试。');
    }
  };
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const running = snapshot.status === 'running';
  const requesting = snapshot.status === 'requesting';
  const currentPitch = snapshot.frame?.pitch ?? null;
  const displayedFrame = frozen?.frame ?? snapshot.frame ?? data.latest ?? null;
  const displayedHistory = frozen?.frames ?? session.history;
  const endTime = frozen?.endTime ?? displayedFrame?.time ?? 0;
  const deviation = targetDeviation(snapshot.frame, target);
  const activeView = VIEWS.find((item) => item.id === view)!;
  const peaks = displayedFrame
    ? spectralPeaks(displayedFrame.spectrum, displayedFrame.sampleRate, 3)
    : [];
  const db = snapshot.frame?.rmsDb ?? -Infinity;
  const level = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
  const frameSize = displayedFrame ? displayedFrame.sampleRate / FFT_SIZE : null;
  const waveformWindows = [5, 10, 20, 50].filter(
    (value) =>
      !displayedFrame ||
      value <= (displayedFrame.waveform.length / displayedFrame.sampleRate) * 1000,
  );
  const waveformWindow = Math.min(milliseconds, waveformWindows.at(-1) ?? 5);

  useEffect(
    () => () => {
      session.stop();
      piano.dispose();
    },
    [session, piano],
  );
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    let active = true;
    const refresh = () =>
      void navigator.mediaDevices
        .enumerateDevices()
        .then((list) => {
          if (active) setDevices(list.filter((device) => device.kind === 'audioinput'));
        })
        .catch(() => undefined);
    refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      active = false;
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, [running]);

  const playNote = useCallback(
    (midi: number) => {
      setTarget(midi);
      setPlaybackError('');
      void piano
        .play(midi)
        .catch(() => setPlaybackError('参考音无法播放。请检查浏览器的声音权限后重试。'));
    },
    [piano],
  );
  const clearTarget = useCallback(() => setTarget(null), []);
  const start = (record = false) =>
    protect(() => {
      audioRef.current?.pause();
      setFrozen(null);
      setCursor(null);
      setFollowing(true);
      setViewStart(0);
      setFileError('');
      void session.start(deviceId, record);
    });
  const toggleFreeze = () => {
    if (frozen) {
      setFrozen(null);
      setFollowing(true);
    } else if (displayedFrame) {
      setViewStart(range.start);
      setFollowing(false);
      setFrozen({ frame: displayedFrame, frames: [...session.history], endTime: data.duration });
    }
  };
  const noteStatus = !currentPitch
    ? running
      ? '未检测到稳定音高'
      : '等待你的声音'
    : deviation !== null && Math.abs(deviation) <= 5
      ? '音准居中，保持住'
      : deviation! > 0
        ? '稍稍降低音高'
        : '稍稍提高音高';

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#" aria-label="声见首页">
          <span className="brand-mark">
            <Activity size={23} strokeWidth={1.7} />
          </span>
          <strong>声见</strong>
          <span className="brand-divider" />
          <span className="brand-en">PITCH STUDIO</span>
        </a>
        <div className="header-right">
          <span className="privacy">
            <ShieldCheck size={14} />
            声音只留在你的设备
          </span>
          <button
            className="help-button"
            aria-expanded={showHelp}
            onClick={() => setShowHelp(!showHelp)}
          >
            <CircleHelp size={17} />
            <span>使用指南</span>
          </button>
        </div>
      </header>

      <main>
        <div className="workspace-heading">
          <div>
            <div className="eyebrow">YOUR VOICE, IN DETAIL</div>
            <h1>
              听见声音，也看见声音<span>。</span>
            </h1>
            <p>从一个音高，到每一次振动。探索你声音里的细节。</p>
          </div>
          <div className="workspace-index">
            <span>声 音 实 验 室</span>
            <span>01 / LIVE ANALYSIS</span>
          </div>
        </div>
        {showHelp && (
          <aside className="help-panel">
            <div>
              <Headphones size={18} />
              <strong>三个简单的步骤</strong>
            </div>
            <button aria-label="关闭指南" onClick={() => setShowHelp(false)}>
              <X size={16} />
            </button>
            <p>
              ① 开启麦克风并允许访问。② 唱一个长音，切换三个页签观察。③
              点击钢琴听参考音，再跟唱比较音准。
            </p>
            <p>
              频谱的峰表示不同频率的强度；声谱图记录它们的变化；波形显示振动。冻结只暂停图表，停止麦克风才会结束采集。
            </p>
            <p>适合单人发声。读数是数字信号电平，不是环境声压；设备自带的音效也可能改变输入。</p>
          </aside>
        )}

        <section className="input-strip" aria-label="麦克风控制">
          <div className="input-icon">
            <Mic size={19} />
          </div>
          <div className="input-device">
            <label htmlFor="microphone">音频输入</label>
            <div className="select-wrapper">
              <select
                id="microphone"
                value={deviceId}
                disabled={active || fileBusy}
                onChange={(event) => setDeviceId(event.target.value)}
                title={running ? '停止麦克风后可切换设备' : '选择输入设备'}
              >
                <option value="">{running ? snapshot.deviceLabel : '默认麦克风'}</option>
                {devices
                  .filter((device) => device.deviceId && device.deviceId !== 'default')
                  .map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `麦克风 ${index + 1}`}
                    </option>
                  ))}
              </select>
              <ChevronDown size={13} />
            </div>
          </div>
          <div className="session-indicator">
            <i
              className={
                running ? 'status-dot active' : requesting ? 'status-dot pending' : 'status-dot'
              }
            />
            <span>
              {running
                ? data.recorded
                  ? '正在录音'
                  : '仅分析 · 未录音'
                : requesting
                  ? '等待麦克风授权'
                  : snapshot.status === 'error'
                    ? '输入未连接'
                    : '麦克风未开启'}
            </span>
          </div>
          {running && (
            <span className="sample-rate">
              {(snapshot.frame?.sampleRate ?? 0) / 1000 || '—'} kHz
            </span>
          )}
          <button
            className={`mic-button ${running || requesting ? 'stop' : ''}`}
            disabled={snapshot.status === 'stopping' || fileBusy}
            onClick={() => (active ? void session.stop() : start())}
          >
            {running || requesting ? <Square size={15} fill="currentColor" /> : <Mic size={17} />}
            {running
              ? '停止麦克风'
              : requesting
                ? '取消'
                : snapshot.status === 'stopping'
                  ? '正在结束…'
                  : '开启麦克风'}
          </button>
          {!active && (
            <button
              className="mic-button record-button"
              disabled={fileBusy}
              onClick={() => start(true)}
            >
              ● 开始录音
            </button>
          )}
        </section>
        <section className="session-tools panel" aria-label="会话与保存">
          <div className="session-info">
            <strong data-testid="session-duration">{formatTime(data.duration, true)}</strong>
            <span>
              {active
                ? data.recorded
                  ? '录音中 · WAV 48 kHz / 单声道 / 16 位'
                  : '仅分析'
                : data.duration
                  ? data.recorded
                    ? '录音已保留'
                    : '分析已保留'
                  : '开启麦克风仅分析，或选择开始录音'}{' '}
              · 最长 30 分钟
            </span>
          </div>
          <div className="session-actions">
            <button
              disabled={active || fileBusy || !data.wav}
              onClick={() => downloadBlob(data.wav!, data.name + '.wav')}
            >
              下载 WAV
            </button>
            <button disabled={active || fileBusy || !data.duration} onClick={saveSession}>
              保存完整会话
            </button>
            <button disabled={active || fileBusy} onClick={() => importRef.current?.click()}>
              {fileBusy ? '正在读取…' : '打开会话'}
            </button>
            <input
              ref={importRef}
              hidden
              aria-label="导入会话文件"
              type="file"
              accept=".pitchsession"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void importSession(file);
              }}
            />
            <span className="muted small">
              {snapshot.dirty
                ? '会话尚未保存'
                : data.duration
                  ? '会话已导出或导入'
                  : '文件仅在本机处理'}
            </span>
          </div>
          {!active && audioUrl && (
            <audio
              ref={audioRef}
              aria-label="录音回放"
              controls
              src={audioUrl}
              onTimeUpdate={(event) => {
                const t = event.currentTarget.currentTime;
                setCursor(t);
                if (
                  !event.currentTarget.paused &&
                  windowSeconds &&
                  (t < range.start || t > range.end)
                )
                  navigate(Math.floor(t / windowSeconds) * windowSeconds);
              }}
            />
          )}
          {(snapshot.notice || fileError) && (
            <p role={fileError ? 'alert' : 'status'}>{fileError || snapshot.notice}</p>
          )}
        </section>
        {pending && (
          <dialog
            className="save-dialog"
            ref={(element) => {
              if (element && !element.open) element.showModal();
            }}
            onCancel={() => setPending(null)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="unsaved-title"
          >
            <h2 id="unsaved-title">保存当前会话？</h2>
            <p>当前结果尚未保存为完整会话。继续后将替换它；WAV 或 PNG 无法单独恢复全部分析数据。</p>
            <div>
              <button
                autoFocus
                onClick={() => {
                  saveSession();
                  const action = pending;
                  setPending(null);
                  action();
                }}
              >
                保存并继续
              </button>
              <button
                onClick={() => {
                  const action = pending;
                  setPending(null);
                  action();
                }}
              >
                放弃并继续
              </button>
              <button onClick={() => setPending(null)}>取消</button>
            </div>
          </dialog>
        )}
        {snapshot.error && (
          <div className="error-banner" role="alert">
            {snapshot.error}
            <button onClick={() => start(data.recorded)}>重试</button>
          </div>
        )}

        <section className="panel tuner-panel" aria-label="实时调音器">
          <div className="tuner-readout">
            <div className="label-row">
              <span className="eyebrow">实时音高</span>
              <span className={`live-tag ${running ? 'on' : ''}`}>LIVE</span>
            </div>
            <div className="note-line">
              <span className="current-note" data-testid="pitch-note">
                {currentPitch?.note ?? '—'}
                <sub>{currentPitch?.octave ?? ''}</sub>
              </span>
              <div className="hz-readout">
                <span data-testid="pitch-hz">
                  {currentPitch ? currentPitch.hz.toFixed(1) : '—'}
                </span>
                <small>Hz</small>
              </div>
            </div>
            <div
              className={`note-status ${currentPitch && Math.abs(deviation ?? 100) <= 5 ? 'in-tune' : ''}`}
            >
              <i />
              {noteStatus}
            </div>
          </div>
          <div className="tuning-center">
            <div className="label-row">
              <span className="eyebrow">
                {target === null ? '音准偏差' : `目标 ${noteName(target)} 的偏差`}
              </span>
              <span className="cents-value" data-testid="cents">
                {deviation === null
                  ? '—'
                  : `${deviation >= 0 ? '+' : '−'}${Math.abs(deviation).toFixed(1)}`}
                <small> cents</small>
              </span>
            </div>
            <div className="tuning-meter">
              <div className="tuning-zone" />
              <div className="tuning-ticks">
                {Array.from({ length: 21 }, (_, index) => (
                  <i key={index} className={index % 5 === 0 ? 'major' : ''} />
                ))}
              </div>
              <span className="center-mark" />
              {deviation !== null && (
                <span
                  className="tuning-needle"
                  style={{ left: `${50 + Math.max(-50, Math.min(50, deviation))}%` }}
                />
              )}
            </div>
            <div className="tuning-labels">
              <span>
                −50 <small>偏低</small>
              </span>
              <span>0</span>
              <span>
                <small>偏高</small> +50
              </span>
            </div>
            <div className="level-row">
              <span>输入电平</span>
              <div
                className="level-meter"
                role="meter"
                aria-label="麦克风输入电平"
                aria-valuemin={-60}
                aria-valuemax={0}
                aria-valuenow={Number.isFinite(db) ? Math.max(-60, Math.min(0, db)) : -60}
              >
                <i
                  style={{ width: `${level}%` }}
                  className={snapshot.frame?.peak && snapshot.frame.peak >= 0.99 ? 'clipping' : ''}
                />
              </div>
              <span className="db-readout">{Number.isFinite(db) ? db.toFixed(0) : '−∞'} dBFS</span>
            </div>
            {snapshot.frame && snapshot.frame.peak >= 0.99 && (
              <span className="clip-warning">输入接近削波，请降低麦克风增益</span>
            )}
          </div>
          <div className="history-area">
            <div className="label-row">
              <span className="eyebrow">音高轨迹</span>
              <span className="muted small">
                {formatTime(range.start)} — {formatTime(range.end)}
                {frozen ? ' · 已冻结' : ''}
              </span>
            </div>
            <TimeChart
              data={data}
              range={range}
              kind="pitch"
              target={target}
              cursor={cursor}
              revision={frozen ? 0 : snapshot.revision}
              cutoff={frozen?.endTime ?? data.duration}
              onSeek={seek}
            />
          </div>
        </section>

        <section className="panel analysis-panel" aria-label="声音可视化">
          <div className="analysis-toolbar">
            <div className="tabs" role="tablist" aria-label="声音分析视图">
              {VIEWS.map((item, index) => (
                <button
                  key={item.id}
                  ref={(element) => {
                    tabRefs.current[index] = element;
                  }}
                  id={`tab-${item.id}`}
                  role="tab"
                  aria-selected={view === item.id}
                  aria-controls="analysis-content"
                  tabIndex={view === item.id ? 0 : -1}
                  className={view === item.id ? 'selected' : ''}
                  onClick={() => setView(item.id)}
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    const next =
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? 2
                          : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
                    setView(VIEWS[next].id);
                    tabRefs.current[next]?.focus();
                  }}
                >
                  <item.icon size={16} />
                  {item.name}
                </button>
              ))}
            </div>
            <button
              className={`freeze-button ${frozen ? 'is-frozen' : ''}`}
              disabled={!displayedFrame}
              onClick={toggleFreeze}
              aria-pressed={!!frozen}
            >
              {frozen ? <Play size={13} /> : <Pause size={13} />}
              {frozen ? '恢复实时' : '冻结画面'}
            </button>
          </div>
          <div id="analysis-content" role="tabpanel" aria-labelledby={`tab-${view}`} tabIndex={0}>
            <div className="chart-heading">
              <div>
                <h2>{activeView.subtitle}</h2>
                <p>{activeView.helper}</p>
              </div>
              <div className="chart-options">
                {view === 'waveform' ? (
                  <>
                    <label>
                      窗口
                      <select
                        aria-label="波形时间窗口"
                        value={waveformWindow}
                        onChange={(event) => setMilliseconds(Number(event.target.value))}
                      >
                        {waveformWindows.map((value) => (
                          <option key={value} value={value}>
                            {value} ms
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      放大
                      <select
                        aria-label="波形显示放大"
                        value={gain}
                        onChange={(event) => setGain(Number(event.target.value))}
                      >
                        {[1, 2, 4, 8].map((value) => (
                          <option key={value} value={value}>
                            {value}×
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : (
                  <span className="range-label">
                    50 Hz — 8 kHz <span>·</span> 对数刻度
                  </span>
                )}
              </div>
            </div>
            {view !== 'spectrum' && (
              <TimeChart
                data={data}
                range={range}
                kind={view}
                cursor={cursor}
                revision={frozen ? 0 : snapshot.revision}
                cutoff={frozen?.endTime ?? data.duration}
                onSeek={seek}
              />
            )}
            {view === 'waveform' && (
              <p className="detail-caption">
                实时振动细节 · 下图为最后采集的毫秒快照，不随历史播放变化
              </p>
            )}
            {view !== 'spectrogram' && (
              <AnalysisChart
                view={view}
                frame={displayedFrame}
                frames={displayedHistory}
                endTime={endTime}
                milliseconds={waveformWindow}
                gain={gain}
                frozen={!!frozen}
                running={running}
              />
            )}
            <div className="chart-footer">
              {view === 'spectrum' ? (
                <div className="peak-list">
                  <span>频率峰值</span>
                  {peaks.length ? (
                    peaks.map((peak, index) => (
                      <span className="peak-chip" key={index}>
                        <i />
                        {peak.hz.toFixed(0)}
                        <small> Hz</small>
                      </span>
                    ))
                  ) : (
                    <span className="muted">等待声音输入</span>
                  )}
                </div>
              ) : view === 'spectrogram' ? (
                <div className="color-legend">
                  <span>弱</span>
                  <i />
                  <span>强</span>
                  <small>−100 至 −15 dB</small>
                </div>
              ) : (
                <span>
                  正向过零触发 <b>·</b>{' '}
                  {gain > 1 ? `${gain}× 仅放大显示，悬停读数为原始振幅` : '悬停查看原始采样振幅'}
                </span>
              )}
              <span className="chart-note">
                {frozen
                  ? '采集继续 · 图表已冻结'
                  : !running && displayedFrame
                    ? '已停止 · 保留最后画面'
                    : view === 'spectrogram'
                      ? '会话时间 · 空缺表示无分析数据'
                      : view === 'spectrum' && frameSize
                        ? `频率间隔 ${frameSize.toFixed(2)} Hz`
                        : '悬停查看数值'}
              </span>
            </div>
          </div>
        </section>

        <section className="panel timeline-controls" aria-label="时间轴导航">
          <div className="timeline-toolbar">
            <label>
              显示范围{' '}
              <select
                aria-label="时间轴范围"
                value={windowSeconds}
                onChange={(event) => {
                  const seconds = Number(event.target.value);
                  setWindowSeconds(seconds);
                  setViewStart(range.start);
                }}
              >
                <option value={10}>10 秒</option>
                <option value={30}>30 秒</option>
                <option value={60}>1 分钟</option>
                <option value={300}>5 分钟</option>
                <option value={0}>整段概览</option>
              </select>
            </label>
            <button
              onClick={() => {
                setFrozen(null);
                setFollowing(true);
              }}
            >
              回到实时
            </button>
            <span className="muted small">
              {following && !frozen ? '自动跟随' : active ? '正在回看 · 采集不受影响' : '正在回看'}{' '}
              · 拖动下方波形或左右滚动定位
            </span>
            <label>
              图像范围{' '}
              <select
                aria-label="图像范围"
                value={imageScope}
                disabled={view === 'spectrum'}
                onChange={(event) => setImageScope(event.target.value)}
              >
                <option value="visible">当前可见范围</option>
                <option value="whole">整段概览</option>
              </select>
            </label>
            <button disabled={!data.duration} onClick={() => void exportImage()}>
              保存 PNG
            </button>
          </div>
          <Navigator data={data} range={range} revision={snapshot.revision} onNavigate={navigate} />
          <p className="muted small">
            停止录音后，点击音高曲线、声谱图或波形概览可跳转播放位置。刷新前请保存完整会话。
          </p>
        </section>
        <Piano
          target={target}
          detected={currentPitch?.midi ?? null}
          onPlay={playNote}
          onClear={clearTarget}
        />
        {playbackError && (
          <div className="error-banner" role="alert">
            {playbackError}
          </div>
        )}
        <div className="bottom-row">
          <span>
            <ShieldCheck size={13} />
            本地处理 · 仅“开始录音”保存声音 · 不上传
          </span>
          <details className="capture-settings">
            <summary>
              <SlidersHorizontal size={13} />
              采集状态
              <ChevronDown size={12} />
            </summary>
            <div className="settings-popover">
              <strong>浏览器实际采集设置</strong>
              {snapshot.settings ? (
                <>
                  <span>
                    回声消除 <b>{settingLabel(snapshot.settings.echoCancellation)}</b>
                  </span>
                  <span>
                    自动增益 <b>{settingLabel(snapshot.settings.autoGainControl)}</b>
                  </span>
                  <span>
                    降噪 <b>{settingLabel(snapshot.settings.noiseSuppression)}</b>
                  </span>
                  <span>
                    设备采样率 <b>{snapshot.settings.sampleRate ?? '未报告'} Hz</b>
                  </span>
                  <p>已请求关闭音频处理。此处显示浏览器报告值，设备自带处理可能仍然生效。</p>
                </>
              ) : (
                <p>开启麦克风后查看。会请求关闭回声消除、降噪和自动增益。</p>
              )}
            </div>
          </details>
        </div>
      </main>
      <footer className="site-footer">
        <span>
          声见 <span className="footer-slash">/</span> Pitch Studio
        </span>
        <span>给每一个声音，多一种看见的方式。</span>
      </footer>
    </div>
  );
}
