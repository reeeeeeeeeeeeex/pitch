import {
  FFT_SIZE,
  PITCH_SIZE,
  PitchAnalysis,
  measureLevel,
  pruneHistory,
  type AnalysisFrame,
} from './analysis';
import {
  emptySession,
  RECORD_RATE,
  MAX_SECONDS,
  wavHeader,
  HistoryStore,
  EnvelopeStore,
  type SessionData,
} from './history';
export type SessionStatus = 'idle' | 'requesting' | 'running' | 'stopping' | 'error';
export interface SessionSnapshot {
  status: SessionStatus;
  error: string | null;
  notice: string | null;
  frame: AnalysisFrame | null;
  revision: number;
  deviceLabel: string;
  settings: MediaTrackSettings | null;
  dirty: boolean;
  data: SessionData;
}
export function microphoneError(error: unknown): string {
  switch (error instanceof Error || error instanceof DOMException ? error.name : '') {
    case 'NotAllowedError':
      return 'Microphone access is blocked. Allow this site to use your microphone in the browser address bar, then try again.';
    case 'NotFoundError':
      return 'No microphone found. Connect an input device and try again.';
    case 'NotReadableError':
      return 'Unable to access the microphone. Check your system input settings or close any app using the microphone exclusively.';
    case 'OverconstrainedError':
      return 'The selected microphone is unavailable. Choose the default microphone and try again.';
    default:
      return 'Unable to start the microphone. Open the app in a current version of Chrome or Edge over localhost or HTTPS, and check microphone permissions.';
  }
}
export class AudioSession {
  private snapshot: SessionSnapshot = {
    status: 'idle',
    error: null,
    notice: null,
    frame: null,
    revision: 0,
    deviceLabel: '',
    settings: null,
    dirty: false,
    data: emptySession(),
  };
  private listeners = new Set<() => void>();
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private nodes: AudioNode[] = [];
  private timeAnalyser: AnalyserNode | null = null;
  private frequencyAnalyser: AnalyserNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private stopping: Promise<void> | null = null;
  private resolveStop: (() => void) | null = null;
  private generation = 0;
  private pitch = new PitchAnalysis();
  private origin: number | null = null;
  private lastTime = -Infinity;
  private pcm: Blob[] = [];
  private pcmBytes = 0;
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
  markSaved() {
    this.publish({ dirty: false });
  }
  load(data: SessionData) {
    if (this.context) throw new Error('Stop capture first');
    this.history.length = 0;
    if (data.latest) this.history.push(data.latest);
    this.publish({
      status: 'idle',
      error: null,
      notice: 'Session opened. You can now review and export it.',
      data,
      frame: null,
      settings: data.settings,
      dirty: false,
    });
  }
  async start(deviceId = '', record = false): Promise<void> {
    await this.stop();
    const generation = ++this.generation;
    this.history.length = 0;
    this.pcm = [];
    this.pcmBytes = 0;
    this.origin = null;
    this.lastTime = -Infinity;
    const data = emptySession(record);
    this.publish({
      status: 'requesting',
      error: null,
      notice: null,
      frame: null,
      settings: null,
      dirty: false,
      data,
    });
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error('Secure context required');
      const context = new AudioContext({ latencyHint: 'interactive', sampleRate: RECORD_RATE });
      this.context = context;
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
      if (context.state !== 'running' || context.sampleRate !== RECORD_RATE)
        throw new Error('48 kHz audio unavailable');
      await context.audioWorklet.addModule(`${import.meta.env.BASE_URL}capture-worklet.js`);
      if (generation !== this.generation) return;
      const track = stream.getAudioTracks()[0];
      const source = context.createMediaStreamSource(stream);
      const mono = new GainNode(context, { channelCount: 1, channelCountMode: 'explicit' });
      this.timeAnalyser = new AnalyserNode(context, { fftSize: PITCH_SIZE });
      this.frequencyAnalyser = new AnalyserNode(context, {
        fftSize: FFT_SIZE,
        smoothingTimeConstant: 0,
      });
      const worklet = new AudioWorkletNode(context, 'pitch-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { record },
      });
      this.worklet = worklet;
      source.connect(mono);
      mono.connect(this.timeAnalyser);
      mono.connect(this.frequencyAnalyser);
      mono.connect(worklet);
      worklet.connect(context.destination);
      this.nodes = [source, mono, this.timeAnalyser, this.frequencyAnalyser, worklet];
      data.settings = track.getSettings();
      this.publish({ settings: data.settings, deviceLabel: track.label });
      worklet.port.onmessage = ({ data: message }) => {
        if (generation !== this.generation) return;
        if (message.type === 'started') {
          this.origin = message.origin;
          this.publish({ status: 'running' });
          this.timer = setInterval(() => this.sample(), 1000 / 30);
        }
        if (message.type === 'pcm') {
          this.pcm.push(new Blob([message.buffer]));
          this.pcmBytes += message.buffer.byteLength;
        }
        if (message.type === 'envelope') {
          const values = new Float64Array(message.buffer);
          for (let i = 0; i < values.length; i += 3)
            data.envelopes.append({ time: values[i], min: values[i + 1], max: values[i + 2] });
          data.duration = Math.min(MAX_SECONDS, message.samples / RECORD_RATE);
          this.publish({ dirty: data.duration > 0 });
        }
        if (message.type === 'done')
          void this.finish(
            message.samples,
            message.reason === 'limit'
              ? 'The 30-minute limit has been reached. Capture stopped and the full session has been retained.'
              : null,
          );
      };
      worklet.onprocessorerror = () => {
        this.publish({ error: 'Audio capture failed. Retaining the audio recorded so far.' });
        void this.stop();
      };
      track.addEventListener(
        'ended',
        () => {
          if (generation !== this.generation) return;
          this.publish({
            error: 'Microphone disconnected. The audio recorded so far has been retained.',
          });
          void this.stop();
        },
        { once: true },
      );
      worklet.port.postMessage('start');
    } catch (error) {
      if (generation !== this.generation) return;
      this.generation++;
      this.release();
      this.publish({ status: 'error', error: microphoneError(error) });
    }
  }
  private sample() {
    if (
      !this.context ||
      !this.timeAnalyser ||
      !this.frequencyAnalyser ||
      this.origin === null ||
      this.snapshot.status !== 'running'
    )
      return;
    if (this.context.state !== 'running') {
      this.publish({ frame: null });
      return;
    }
    const now = this.context.currentTime - this.origin;
    if (now < PITCH_SIZE / RECORD_RATE || now > MAX_SECONDS || now <= this.lastTime) return;
    this.lastTime = now;
    const waveform = new Float32Array(PITCH_SIZE),
      spectrum = new Float32Array(FFT_SIZE / 2);
    this.timeAnalyser.getFloatTimeDomainData(waveform);
    this.frequencyAnalyser.getFloatFrequencyData(spectrum);
    const level = measureLevel(waveform);
    const frame: AnalysisFrame = {
      time: now,
      waveform,
      spectrum,
      sampleRate: RECORD_RATE,
      ...level,
      pitch: this.pitch.detect(waveform, RECORD_RATE, level.rmsDb),
    };
    this.history.push(frame);
    pruneHistory(this.history, now);
    this.snapshot.data.history.append(frame);
    this.snapshot.data.latest = frame;
    this.publish({ frame, dirty: true });
  }
  private async finish(samples: number, notice: string | null) {
    const data = this.snapshot.data;
    data.duration = data.recorded ? this.pcmBytes / 2 / RECORD_RATE : samples / RECORD_RATE;
    if (data.recorded && this.pcmBytes)
      data.wav = new Blob([wavHeader(this.pcmBytes / 2), ...this.pcm], { type: 'audio/wav' });
    this.pcm = [];
    this.pcmBytes = 0;
    this.generation++;
    this.release();
    // In an interrupted processor, retain only history aligned with recovered audio.
    if (data.history.length && data.history.get(data.history.length - 1).time > data.duration) {
      const bytes = data.history.lowerBound(data.duration + Number.EPSILON) * 536;
      data.history = HistoryStore.fromBuffer(
        await data.history.toBlob().slice(0, bytes).arrayBuffer(),
        data.duration,
      );
    }
    if (
      data.envelopes.levels[0].at(-1)?.time &&
      data.envelopes.levels[0].at(-1)!.time > data.duration
    ) {
      const values = data.envelopes.levels[0];
      let count = values.length;
      while (count && values[count - 1].time > data.duration) count--;
      data.envelopes = EnvelopeStore.fromBuffer(
        await data.envelopes
          .toBlob()
          .slice(0, count * 16)
          .arrayBuffer(),
        data.duration,
      );
    }
    if (data.latest && data.latest.time > data.duration) data.latest = null;
    this.history.length = 0;
    if (data.latest) this.history.push(data.latest);
    this.publish({
      status: this.snapshot.error ? 'error' : 'idle',
      frame: null,
      dirty: data.duration > 0,
      notice,
    });
    this.resolveStop?.();
    this.resolveStop = null;
    this.stopping = null;
  }
  stop = (): Promise<void> => {
    if (this.stopping) return this.stopping;
    if (!this.worklet || this.origin === null) {
      this.generation++;
      this.release();
      this.publish({ status: 'idle', frame: null });
      return Promise.resolve();
    }
    this.stopping = new Promise((resolve) => {
      this.resolveStop = resolve;
    });
    this.publish({ status: 'stopping' });
    if (this.context?.state === 'suspended') void this.context.resume().catch(() => undefined);
    this.worklet.port.postMessage('stop');
    this.stopTimer = setTimeout(() => {
      this.publish({
        error:
          'The capture thread stopped responding. Received audio and analysis data have been retained.',
      });
      void this.finish(this.snapshot.data.duration * RECORD_RATE, null);
    }, 2000);
    return this.stopping;
  };
  private release() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    if (this.worklet) {
      this.worklet.port.onmessage = null;
      this.worklet.onprocessorerror = null;
      this.worklet.port.close();
    }
    this.worklet = null;
    this.nodes.forEach((node) => node.disconnect());
    this.nodes = [];
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.timeAnalyser = null;
    this.frequencyAnalyser = null;
    if (this.context && this.context.state !== 'closed')
      void this.context.close().catch(() => undefined);
    this.context = null;
  }
}
