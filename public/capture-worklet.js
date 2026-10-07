/* Continuous mono capture. No microphone signal is connected to the audible output. */
class PitchCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.record = !!options.processorOptions?.record;
    this.active = false;
    this.origin = null;
    this.samples = 0;
    this.limit = sampleRate * 1800;
    this.pcm = new Int16Array(sampleRate);
    this.pcmLength = 0;
    this.envelopes = [];
    this.envelopeSamples = 0;
    this.low = 1;
    this.high = -1;
    this.port.onmessage = ({ data }) => {
      if (data === 'start') this.active = true;
      if (data === 'stop') this.finish('stopped');
    };
  }
  flushPCM() {
    if (!this.record || !this.pcmLength) return;
    const buffer = this.pcm.buffer.slice(0, this.pcmLength * 2);
    this.port.postMessage({ type: 'pcm', buffer }, [buffer]);
    this.pcmLength = 0;
  }
  flushEnvelope() {
    if (!this.envelopes.length) return;
    const data = new Float64Array(this.envelopes);
    this.port.postMessage({ type: 'envelope', samples: this.samples, buffer: data.buffer }, [
      data.buffer,
    ]);
    this.envelopes.length = 0;
  }
  finish(reason) {
    if (!this.active) return;
    this.active = false;
    if (this.envelopeSamples) {
      this.envelopes.push(this.samples / sampleRate, this.low, this.high);
      this.envelopeSamples = 0;
    }
    this.flushPCM();
    this.flushEnvelope();
    this.port.postMessage({ type: 'done', samples: this.samples, reason });
  }
  process(inputs) {
    if (!this.active) return true;
    if (this.origin === null) {
      this.origin = currentFrame;
      this.port.postMessage({ type: 'started', origin: currentFrame / sampleRate });
    }
    const input = inputs[0]?.[0];
    const length = input?.length ?? 128;
    for (let i = 0; i < length && this.samples < this.limit; i++) {
      const value = Math.max(-1, Math.min(1, input?.[i] ?? 0));
      if (this.record) {
        this.pcm[this.pcmLength++] = Math.round(value < 0 ? value * 32768 : value * 32767);
        if (this.pcmLength === this.pcm.length) this.flushPCM();
      }
      this.low = Math.min(this.low, value);
      this.high = Math.max(this.high, value);
      this.samples++;
      this.envelopeSamples++;
      if (this.envelopeSamples === sampleRate / 100) {
        this.envelopes.push(this.samples / sampleRate, this.low, this.high);
        this.low = 1;
        this.high = -1;
        this.envelopeSamples = 0;
        if (this.envelopes.length >= 30) this.flushEnvelope();
      }
    }
    if (this.samples >= this.limit) this.finish('limit');
    return true;
  }
}
registerProcessor('pitch-capture', PitchCapture);
