import {
  FFT_SIZE,
  PITCH_SIZE,
  PitchAnalysis,
  measureLevel,
  pruneHistory,
  type AnalysisFrame,
} from './analysis';

export type SessionStatus = 'idle' | 'requesting' | 'running' | 'error';
export interface SessionSnapshot {
  status: SessionStatus;
  error: string | null;
  frame: AnalysisFrame | null;
  revision: number;
  deviceLabel: string;
  settings: MediaTrackSettings | null;
}

const INITIAL: SessionSnapshot = {
  status: 'idle',
  error: null,
  frame: null,
  revision: 0,
  deviceLabel: '',
  settings: null,
};

export function microphoneError(error: unknown): string {
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
      return '麦克风权限未开启。请在浏览器地址栏允许此网站使用麦克风，然后重试。';
    case 'NotFoundError':
      return '没有找到麦克风。请连接输入设备后重试。';
    case 'NotReadableError':
      return '无法读取麦克风。请检查系统输入设备，或关闭独占使用麦克风的应用。';
    case 'OverconstrainedError':
      return '所选麦克风不可用。请选择默认麦克风后重试。';
    default:
      return '麦克风未能启动。请检查设备与浏览器权限后重试。';
  }
}

export class AudioSession {
  private snapshot: SessionSnapshot = { ...INITIAL };
  private listeners = new Set<() => void>();
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private timeAnalyser: AnalyserNode | null = null;
  private frequencyAnalyser: AnalyserNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  private pitch = new PitchAnalysis();
  private origin = 0;
  private lastTime = -Infinity;
  readonly history: AnalysisFrame[] = [];

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;

  private publish(update: Partial<SessionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...update, revision: this.snapshot.revision + 1 };
    for (const listener of this.listeners) listener();
  }

  async start(deviceId = ''): Promise<void> {
    this.stop();
    const generation = ++this.generation;
    this.history.length = 0;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.publish({
        status: 'error',
        error: '此浏览器无法访问麦克风。请用最新版 Chrome 或 Edge，通过 localhost 或 HTTPS 打开。',
      });
      return;
    }
    this.publish({ status: 'requesting', error: null, frame: null, settings: null });
    try {
      const context = new AudioContext({ latencyHint: 'interactive' });
      this.context = context;
      // Resume within the user's click gesture, before waiting for the permission dialog.
      const resume = context.resume().catch(() => undefined);
      const supported = navigator.mediaDevices.getSupportedConstraints();
      const audio: MediaTrackConstraints = { channelCount: { ideal: 1 } };
      if (deviceId) audio.deviceId = { exact: deviceId };
      if (supported.echoCancellation) audio.echoCancellation = false;
      if (supported.noiseSuppression) audio.noiseSuppression = false;
      if (supported.autoGainControl) audio.autoGainControl = false;
      const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      await resume;
      if (generation !== this.generation) return;
      if (context.state !== 'running') {
        throw new Error('Audio context did not start');
      }
      const track = stream.getAudioTracks()[0];
      this.source = context.createMediaStreamSource(stream);
      this.timeAnalyser = new AnalyserNode(context, { fftSize: PITCH_SIZE });
      this.frequencyAnalyser = new AnalyserNode(context, {
        fftSize: FFT_SIZE,
        smoothingTimeConstant: 0,
      });
      this.source.connect(this.timeAnalyser);
      this.source.connect(this.frequencyAnalyser);
      // The microphone graph intentionally has no audible output.
      this.origin = performance.now() / 1000;
      this.lastTime = -Infinity;
      this.publish({
        status: 'running',
        deviceLabel: track.label || '麦克风',
        settings: track.getSettings(),
      });
      track.addEventListener(
        'ended',
        () => {
          if (generation !== this.generation) return;
          this.stop();
          this.publish({
            status: 'error',
            error: '麦克风已断开。重新连接设备后，点击开启麦克风。',
          });
        },
        { once: true },
      );
      this.timer = setInterval(() => this.sample(), 1000 / 30);
      this.sample();
    } catch (error) {
      if (generation !== this.generation) return;
      this.stop();
      this.publish({ status: 'error', error: microphoneError(error) });
    }
  }

  private sample() {
    if (!this.context || !this.timeAnalyser || !this.frequencyAnalyser) return;
    const now = performance.now() / 1000 - this.origin;
    pruneHistory(this.history, now);
    // Suspended audio must not leave a stale pitch or repeat old samples as new input.
    if (this.context.state !== 'running') {
      this.publish({ frame: null });
      return;
    }
    if (this.context.currentTime === this.lastTime) return;
    this.lastTime = this.context.currentTime;
    const waveform = new Float32Array(PITCH_SIZE);
    const spectrum = new Float32Array(FFT_SIZE / 2);
    this.timeAnalyser.getFloatTimeDomainData(waveform);
    this.frequencyAnalyser.getFloatFrequencyData(spectrum);
    const level = measureLevel(waveform);
    const frame: AnalysisFrame = {
      time: now,
      waveform,
      spectrum,
      sampleRate: this.context.sampleRate,
      ...level,
      pitch: this.pitch.detect(waveform, this.context.sampleRate, level.rmsDb),
    };
    this.history.push(frame);
    this.publish({ frame });
  }

  stop = () => {
    this.generation++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.source?.disconnect();
    this.source = null;
    this.timeAnalyser?.disconnect();
    this.timeAnalyser = null;
    this.frequencyAnalyser?.disconnect();
    this.frequencyAnalyser = null;
    if (this.context && this.context.state !== 'closed')
      void this.context.close().catch(() => undefined);
    this.context = null;
    this.publish({ status: 'idle', frame: null });
  };
}
