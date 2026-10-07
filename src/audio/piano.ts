import { pianoSample } from './piano-notes';

interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export class ReferencePiano {
  private context: AudioContext | null = null;
  private output: DynamicsCompressorNode | null = null;
  private voices = new Set<Voice>();
  private buffers = new Map<number, AudioBuffer>();
  private pending: {
    midi: number;
    controller: AbortController;
    promise: Promise<AudioBuffer>;
  } | null = null;
  private request = 0;

  private async load(context: AudioContext, sample: ReturnType<typeof pianoSample>) {
    const cached = this.buffers.get(sample.midi);
    if (cached) {
      this.pending?.controller.abort();
      this.buffers.delete(sample.midi);
      this.buffers.set(sample.midi, cached);
      return cached;
    }
    if (this.pending?.midi === sample.midi && !this.pending.controller.signal.aborted)
      return this.pending.promise;
    this.pending?.controller.abort();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const promise = (async () => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}piano/salamander/${sample.file}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Piano sample: HTTP ${response.status}`);
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        controller.signal.throwIfAborted();
        this.buffers.set(sample.midi, buffer);
        // Bound decoded PCM memory; MP3 files can still use the browser HTTP cache.
        if (this.buffers.size > 8) this.buffers.delete(this.buffers.keys().next().value!);
        return buffer;
      } finally {
        clearTimeout(timer);
        if (this.pending?.controller === controller) this.pending = null;
      }
    })();
    this.pending = { midi: sample.midi, controller, promise };
    return promise;
  }

  async play(midi: number): Promise<void> {
    const sample = pianoSample(midi);
    const request = ++this.request;
    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContext();
      this.output = this.context.createDynamicsCompressor();
      this.output.threshold.value = -12;
      this.output.knee.value = 12;
      this.output.ratio.value = 4;
      this.output.connect(this.context.destination);
    }
    const context = this.context;
    let buffer: AudioBuffer;
    try {
      // Resume synchronously from the key gesture; decode only the requested sample.
      [, buffer] = await Promise.all([context.resume(), this.load(context, sample)]);
    } catch (error) {
      if (request !== this.request) return;
      throw error;
    }
    // Do not sound an old key after a slow download, or after disposal.
    if (request !== this.request || context !== this.context) return;
    if (context.state !== 'running') throw new Error('Audio output is suspended');
    const now = context.currentTime;
    if (this.voices.size >= 8) {
      const oldest = this.voices.values().next().value!;
      oldest.gain.gain.cancelAndHoldAtTime(now);
      oldest.gain.gain.linearRampToValueAtTime(0, now + 0.03);
      oldest.source.stop(now + 0.03);
      this.voices.delete(oldest);
    }
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = sample.rate;
    // Preserve the recorded attack and natural decay, then gently release the
    // reference note. This output graph is independent of microphone analysis.
    const duration = Math.min(4, buffer.duration / sample.rate);
    gain.gain.setValueAtTime(0.65, now);
    gain.gain.setValueAtTime(0.65, now + Math.max(0, duration - 0.7));
    gain.gain.linearRampToValueAtTime(0, now + duration);
    source.connect(gain).connect(this.output!);
    const voice = { source, gain };
    this.voices.add(voice);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      this.voices.delete(voice);
    };
    source.start(now);
    source.stop(now + duration);
  }

  dispose() {
    this.request++;
    this.pending?.controller.abort();
    this.pending = null;
    this.buffers.clear();
    for (const voice of this.voices) {
      try {
        voice.source.stop();
      } catch {
        /* already ended */
      }
      voice.source.disconnect();
      voice.gain.disconnect();
    }
    this.voices.clear();
    this.output?.disconnect();
    this.output = null;
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
