import { t, useLanguage, setLanguage, translateMessage } from './i18n';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Activity,
  AudioLines,
  ChartNoAxesCombined,
  ChevronDown,
  CircleHelp,
  Headphones,
  Languages,
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
import {
  clampPitchLow,
  DEFAULT_PITCH_LOW,
  followPitchLow,
  PITCH_SPAN,
  PITCH_MIN_LOW,
  PITCH_MAX_LOW,
} from './audio/pitch-viewport';

interface FrozenView {
  frames: AnalysisFrame[];
  frame: AnalysisFrame;
  endTime: number;
}
const settingLabel = (value: boolean | string | undefined) =>
  value === undefined
    ? t('Not reported')
    : typeof value === 'string'
      ? value
      : value
        ? t('On')
        : t('Off');

export default function App() {
  const language = useLanguage();
  const VIEWS = [
    {
      id: 'spectrum' as const,
      name: t('Spectrum'),
      icon: ChartNoAxesCombined,
      subtitle: t('Explore the frequencies in your voice'),
      helper: t('Frequency on the x-axis · Relative level on the y-axis'),
    },
    {
      id: 'spectrogram' as const,
      name: t('Spectrogram'),
      icon: AudioLines,
      subtitle: t('See how your sound changes over time'),
      helper: t('Time on the x-axis · Frequency on the y-axis · Color shows level'),
    },
    {
      id: 'waveform' as const,
      name: t('Waveform'),
      icon: Waves,
      subtitle: t('See the shape of your sound'),
      helper: t('Time on the x-axis · Sample amplitude on the y-axis'),
    },
  ];
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
  const [pianoLoading, setPianoLoading] = useState(false);
  const [pitchLow, setPitchLow] = useState(DEFAULT_PITCH_LOW);
  const [pitchFollowing, setPitchFollowing] = useState(true);
  const [pitchDragging, setPitchDragging] = useState(false);
  const pianoRequest = useRef(0);
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
    pitchLow,
    pitchFollowing,
  };
  const pitchFrame = data.history.latestPitch(
    range.start,
    Math.min(
      range.end,
      frozen?.endTime ?? data.duration,
      cursor !== null && cursor >= range.start && cursor <= range.end ? cursor : Infinity,
    ),
  );
  const pitchGuide = pitchFrame?.hz ? 69 + 12 * Math.log2(pitchFrame.hz / 440) : target;
  const livePitch = snapshot.status === 'running' ? snapshot.frame?.pitch : null;
  const livePitchTime = snapshot.frame?.time;
  const livePitchHz = livePitch?.hz;
  useEffect(() => {
    if (!livePitchHz || frozen || pitchDragging) return;
    // Every new voiced frame resumes live tracking, including an unchanged note.
    // A drag only holds the range until the user releases it.
    setPitchFollowing(true);
    setPitchLow((low) => followPitchLow(low, 69 + 12 * Math.log2(livePitchHz / 440)));
  }, [livePitchHz, livePitchTime, frozen, pitchDragging]);
  useEffect(() => {
    if (snapshot.status !== 'running' && pitchFollowing && !pitchDragging && !frozen)
      setPitchLow((low) => followPitchLow(low, pitchGuide));
  }, [snapshot.status, pitchFollowing, pitchGuide, pitchLow, pitchDragging, frozen]);
  const panPitch = useCallback((low: number) => {
    setPitchFollowing(false);
    setPitchLow(clampPitchLow(low));
  }, []);
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
        setPitchLow(imported.display.pitchLow ?? DEFAULT_PITCH_LOW);
        setPitchFollowing(imported.display.pitchFollowing ?? true);
        setFrozen(null);
        setFollowing(false);
        setViewStart(0);
        setCursor(null);
      });
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Unable to open the file');
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
        pitchLow,
      );
    } catch {
      setFileError('Unable to save the image. Please try again.');
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
      const request = ++pianoRequest.current;
      setTarget(midi);
      setPlaybackError('');
      setPianoLoading(true);
      void piano
        .play(midi)
        .catch(() => {
          if (request === pianoRequest.current)
            setPlaybackError(
              'Unable to load or play the piano sound. Check your connection and browser audio permissions, then try the key again.',
            );
        })
        .finally(() => {
          if (request === pianoRequest.current) setPianoLoading(false);
        });
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
      setPitchFollowing(true);
      setPitchLow(DEFAULT_PITCH_LOW);
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
      ? t('No steady pitch detected')
      : t('Ready when you are')
    : deviation !== null && Math.abs(deviation) <= 5
      ? t('In tune. Hold it there.')
      : deviation! > 0
        ? t('Try singing a little lower')
        : t('Try singing a little higher');

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#" aria-label={t('Pitch Studio home')}>
          <span className="brand-mark">
            <Activity size={23} strokeWidth={1.7} />
          </span>
          <h1>{t('Pitch Studio')}</h1>
        </a>
        <div className="header-right">
          <label className="language-picker">
            <Languages size={16} aria-hidden="true" />
            <select
              aria-label="Language / 语言"
              value={language}
              onChange={(event) => setLanguage(event.target.value === 'zh-CN' ? 'zh-CN' : 'en')}
            >
              <option value="en">English</option>
              <option value="zh-CN">简体中文</option>
            </select>
          </label>
          <span className="privacy">
            <ShieldCheck size={14} />
            {t('Your audio stays on your device')}
          </span>
          <button
            className="help-button"
            aria-label={t('Quick guide')}
            aria-expanded={showHelp}
            onClick={() => setShowHelp(!showHelp)}
          >
            <CircleHelp size={17} />
            <span>{t('Quick guide')}</span>
          </button>
        </div>
      </header>

      <main>
        {showHelp && (
          <aside className="help-panel">
            <div>
              <Headphones size={18} />
              <strong>{t('Get started in three steps')}</strong>
            </div>
            <button aria-label={t('Close guide')} onClick={() => setShowHelp(false)}>
              <X size={16} />
            </button>
            <p>
              {t(
                '1. Turn on your microphone and allow access. 2. Hold a note and explore the three views. 3. Play a piano key, then sing along to match its pitch.',
              )}
            </p>
            <p>
              {t(
                'The spectrum shows the strength of each frequency, the spectrogram tracks changes over time, and the waveform shows the signal itself. Freeze pauses the display; Stop microphone ends capture.',
              )}
            </p>
            <p>
              {t(
                'Designed for one voice at a time. Levels describe the digital signal, not room sound pressure. Your device may also process the input.',
              )}
            </p>
          </aside>
        )}

        <section className="input-strip" aria-label={t('Microphone controls')}>
          <div className="input-icon">
            <Mic size={19} />
          </div>
          <div className="input-device">
            <label htmlFor="microphone">{t('Audio input')}</label>
            <div className="select-wrapper">
              <select
                id="microphone"
                value={deviceId}
                disabled={active || fileBusy}
                onChange={(event) => setDeviceId(event.target.value)}
                title={
                  running ? t('Stop the microphone to change devices') : t('Choose an input device')
                }
              >
                <option value="">
                  {running ? snapshot.deviceLabel || t('Microphone') : t('Default microphone')}
                </option>
                {devices
                  .filter((device) => device.deviceId && device.deviceId !== 'default')
                  .map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || t('Microphone {0}', index + 1)}
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
                  ? t('Recording')
                  : t('Analyzing · Audio is not being recorded')
                : requesting
                  ? t('Waiting for microphone permission')
                  : snapshot.status === 'error'
                    ? t('Input disconnected')
                    : t('Microphone off')}
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
              ? t('Stop microphone')
              : requesting
                ? t('Cancel')
                : snapshot.status === 'stopping'
                  ? t('Finishing…')
                  : t('Start microphone')}
          </button>
          {!active && (
            <button
              className="mic-button record-button"
              disabled={fileBusy}
              onClick={() => start(true)}
            >
              {t('● Start recording')}
            </button>
          )}
        </section>
        <section className="session-tools panel" aria-label={t('Session and exports')}>
          <div className="session-info">
            <strong data-testid="session-duration">{formatTime(data.duration, true)}</strong>
            <span>
              {active
                ? data.recorded
                  ? t('Recording · WAV 48 kHz / mono / 16-bit')
                  : t('Analyze only')
                : data.duration
                  ? data.recorded
                    ? t('Recording ready')
                    : t('Analysis ready')
                  : t('Start the microphone to analyze, or record to keep the audio')}{' '}
              {t('· Up to 30 minutes')}
            </span>
          </div>
          <div className="session-actions">
            <button
              disabled={active || fileBusy || !data.wav}
              onClick={() => downloadBlob(data.wav!, data.name + '.wav')}
            >
              {t('Download WAV')}
            </button>
            <button disabled={active || fileBusy || !data.duration} onClick={saveSession}>
              {t('Save session')}
            </button>
            <button disabled={active || fileBusy} onClick={() => importRef.current?.click()}>
              {fileBusy ? t('Opening…') : t('Open session')}
            </button>
            <input
              ref={importRef}
              hidden
              aria-label={t('Import session file')}
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
                ? t('Unsaved session')
                : data.duration
                  ? t('Session saved or opened from a file')
                  : t('Files are processed on your device')}
            </span>
          </div>
          {!active && audioUrl && (
            <audio
              ref={audioRef}
              aria-label={t('Recording playback')}
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
            <p role={fileError ? 'alert' : 'status'}>
              {translateMessage(fileError || snapshot.notice || '')}
            </p>
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
            <h2 id="unsaved-title">{t('Save this session?')}</h2>
            <p>
              {t(
                'This session has not been saved. Continuing will replace it. A WAV or PNG alone cannot restore all of your analysis data.',
              )}
            </p>
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
                {t('Save and continue')}
              </button>
              <button
                onClick={() => {
                  const action = pending;
                  setPending(null);
                  action();
                }}
              >
                {t('Discard and continue')}
              </button>
              <button onClick={() => setPending(null)}>{t('Cancel')}</button>
            </div>
          </dialog>
        )}
        {snapshot.error && (
          <div className="error-banner" role="alert">
            {translateMessage(snapshot.error)}
            <button onClick={() => start(data.recorded)}>{t('Retry')}</button>
          </div>
        )}

        <section className="panel tuner-panel" aria-label={t('Live tuner')}>
          <div className="tuner-readout">
            <div className="label-row">
              <span className="eyebrow">{t('Live pitch')}</span>
              <span className={`live-tag ${running ? 'on' : ''}`}>{t('LIVE')}</span>
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
                {target === null ? t('Pitch offset') : t('Offset from {0}', noteName(target))}
              </span>
              <span className="cents-value" data-testid="cents">
                {deviation === null
                  ? '—'
                  : `${deviation >= 0 ? '+' : '−'}${Math.abs(deviation).toFixed(1)}`}
                <small> {t('cents')}</small>
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
                −50 <small>{t('Flat')}</small>
              </span>
              <span>0</span>
              <span>
                <small>{t('Sharp')}</small> +50
              </span>
            </div>
            <div className="level-row">
              <span>{t('Input level')}</span>
              <div
                className="level-meter"
                role="meter"
                aria-label={t('Microphone input level')}
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
              <span className="clip-warning">
                {t('Input is close to clipping. Lower your microphone gain.')}
              </span>
            )}
          </div>
          <div className="history-area">
            <div className="label-row">
              <span className="eyebrow">{t('Pitch trace')}</span>
              <span className="muted small">
                {formatTime(range.start)} — {formatTime(range.end)}
                {frozen ? t(' · Frozen') : ''}
              </span>
            </div>
            <div className="pitch-controls">
              <span className="pitch-range" role="status">
                {noteName(pitchLow)} — {noteName(pitchLow + PITCH_SPAN)} {t('· Two octaves')}
              </span>
            </div>
            <div className="pitch-viewport">
              <TimeChart
                data={data}
                range={range}
                kind="pitch"
                target={target}
                cursor={cursor}
                revision={frozen ? 0 : snapshot.revision}
                cutoff={frozen?.endTime ?? data.duration}
                onSeek={seek}
                pitchLow={pitchLow}
                onPitchPan={panPitch}
                onPitchDragChange={setPitchDragging}
              />
              <div className="pitch-scrollbar">
                <button
                  aria-label={t('Move pitch range up one semitone')}
                  title={t('Move pitch range up one semitone')}
                  disabled={pitchLow === PITCH_MAX_LOW}
                  onClick={() => panPitch(pitchLow + 1)}
                >
                  ↑
                </button>
                <input
                  type="range"
                  aria-label={t('Pitch display range')}
                  aria-orientation="vertical"
                  aria-valuetext={t(
                    '{0} to {1}',
                    noteName(pitchLow),
                    noteName(pitchLow + PITCH_SPAN),
                  )}
                  min={PITCH_MIN_LOW}
                  max={PITCH_MAX_LOW}
                  step={1}
                  value={pitchLow}
                  onChange={(event) => panPitch(Number(event.target.value))}
                  onPointerDown={() => setPitchDragging(true)}
                  onPointerUp={() => setPitchDragging(false)}
                  onPointerCancel={() => setPitchDragging(false)}
                  onLostPointerCapture={() => setPitchDragging(false)}
                />
                <button
                  aria-label={t('Move pitch range down one semitone')}
                  title={t('Move pitch range down one semitone')}
                  disabled={pitchLow === PITCH_MIN_LOW}
                  onClick={() => panPitch(pitchLow - 1)}
                >
                  ↓
                </button>
              </div>
            </div>
            <p className="pitch-hint">
              {t(
                'Follows your pitch live. During playback, drag vertically to adjust the range or click the trace to seek.',
              )}
            </p>
          </div>
        </section>

        <section className="panel analysis-panel" aria-label={t('Audio visualizations')}>
          <div className="analysis-toolbar">
            <div className="tabs" role="tablist" aria-label={t('Audio analysis views')}>
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
              {frozen ? t('Resume display') : t('Freeze display')}
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
                      {t('Window')}
                      <select
                        aria-label={t('Waveform time window')}
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
                      {t('Zoom')}
                      <select
                        aria-label={t('Waveform zoom')}
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
                    50 Hz — 8 kHz <span>·</span> {t('Log scale')}
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
                {t('Waveform detail · Latest captured snapshot; does not follow playback')}
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
                  <span>{t('Frequency peaks')}</span>
                  {peaks.length ? (
                    peaks.map((peak, index) => (
                      <span className="peak-chip" key={index}>
                        <i />
                        {peak.hz.toFixed(0)}
                        <small> Hz</small>
                      </span>
                    ))
                  ) : (
                    <span className="muted">{t('Waiting for audio')}</span>
                  )}
                </div>
              ) : view === 'spectrogram' ? (
                <div className="color-legend">
                  <span>{t('Low')}</span>
                  <i />
                  <span>{t('High')}</span>
                  <small>{t('−100 to −15 dB')}</small>
                </div>
              ) : (
                <span>
                  {t('Rising zero-crossing trigger')}
                  <b>·</b>{' '}
                  {gain > 1
                    ? t('{0}× visual zoom; hover values show the original amplitude', gain)
                    : t('Hover to see the original sample amplitude')}
                </span>
              )}
              <span className="chart-note">
                {frozen
                  ? t('Display frozen · Capture continues')
                  : !running && displayedFrame
                    ? t('Stopped · Showing the last frame')
                    : view === 'spectrogram'
                      ? t('Session time · Gaps indicate missing analysis')
                      : view === 'spectrum' && frameSize
                        ? t('Bin spacing: {0} Hz', frameSize.toFixed(2))
                        : t('Hover for details')}
              </span>
            </div>
          </div>
        </section>

        <section className="panel timeline-controls" aria-label={t('Timeline navigation')}>
          <div className="timeline-toolbar">
            <label>
              {t('Time range')}{' '}
              <select
                aria-label={t('Timeline range')}
                value={windowSeconds}
                onChange={(event) => {
                  const seconds = Number(event.target.value);
                  setWindowSeconds(seconds);
                  setViewStart(range.start);
                }}
              >
                <option value={10}>{t('10 sec')}</option>
                <option value={30}>{t('30 sec')}</option>
                <option value={60}>{t('1 min')}</option>
                <option value={300}>{t('5 min')}</option>
                <option value={0}>{t('Full session')}</option>
              </select>
            </label>
            <button
              onClick={() => {
                setFrozen(null);
                setFollowing(true);
              }}
            >
              {t('Go live')}
            </button>
            <span className="muted small">
              {following && !frozen
                ? t('Following live')
                : active
                  ? t('Browsing history · Capture continues')
                  : t('Browsing history')}{' '}
              {t('· Drag the waveform below or scroll horizontally to navigate')}
            </span>
            <label>
              {t('Image range')}{' '}
              <select
                aria-label={t('Image range')}
                value={imageScope}
                disabled={view === 'spectrum'}
                onChange={(event) => setImageScope(event.target.value)}
              >
                <option value="visible">{t('Visible range')}</option>
                <option value="whole">{t('Full session')}</option>
              </select>
            </label>
            <button disabled={!data.duration} onClick={() => void exportImage()}>
              {t('Save PNG')}
            </button>
          </div>
          <Navigator data={data} range={range} revision={snapshot.revision} onNavigate={navigate} />
          <p className="muted small">
            {t(
              'After recording, click the pitch trace, spectrogram, or waveform overview to seek. Save your session before refreshing the page.',
            )}
          </p>
        </section>
        <Piano
          target={target}
          detected={currentPitch?.midi ?? null}
          loading={pianoLoading}
          onPlay={playNote}
          onClear={clearTarget}
        />
        {playbackError && (
          <div className="error-banner" role="alert">
            {translateMessage(playbackError)}
          </div>
        )}
        <div className="bottom-row">
          <span>
            <ShieldCheck size={13} />
            {t('Processed on your device · Only Record keeps audio · No uploads')}
          </span>
          <details className="capture-settings">
            <summary>
              <SlidersHorizontal size={13} />
              {t('Capture details')}
              <ChevronDown size={12} />
            </summary>
            <div className="settings-popover">
              <strong>{t('Settings reported by your browser')}</strong>
              {snapshot.settings ? (
                <>
                  <span>
                    {t('Echo cancellation')}
                    <b>{settingLabel(snapshot.settings.echoCancellation)}</b>
                  </span>
                  <span>
                    {t('Automatic gain control')}
                    <b>{settingLabel(snapshot.settings.autoGainControl)}</b>
                  </span>
                  <span>
                    {t('Noise suppression')}
                    <b>{settingLabel(snapshot.settings.noiseSuppression)}</b>
                  </span>
                  <span>
                    {t('Device sample rate')}
                    <b>{snapshot.settings.sampleRate ?? t('Not reported')} Hz</b>
                  </span>
                  <p>
                    {t(
                      'Audio processing was requested off. These are the settings reported by your browser; device processing may still apply.',
                    )}
                  </p>
                </>
              ) : (
                <p>
                  {t(
                    'Start the microphone to see its settings. Echo cancellation, noise suppression, and automatic gain control are requested off.',
                  )}
                </p>
              )}
            </div>
          </details>
        </div>
      </main>
    </div>
  );
}
