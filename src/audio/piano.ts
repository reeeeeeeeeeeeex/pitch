import { midiToHz } from './analysis';

export class ReferencePiano {
  private context: AudioContext | null = null;
  private voices = new Set<OscillatorNode>();

  async play(midi: number): Promise<void> {
    if (!this.context || this.context.state === 'closed') this.context = new AudioContext();
    const context = this.context;
    await context.resume();
    if (context.state !== 'running') return;
    // Gentle additive reference tone with a short attack and a piano-like decay.
    // This graph is independent from the microphone analysis graph.
    const now = context.currentTime;
    for (const [harmonic, strength] of [
      [1, 0.17],
      [2, 0.045],
      [3, 0.014],
    ]) {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.frequency.value = midiToHz(midi) * harmonic;
      envelope.gain.setValueAtTime(0, now);
      envelope.gain.linearRampToValueAtTime(strength, now + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + 1.15);
      oscillator.connect(envelope).connect(context.destination);
      this.voices.add(oscillator);
      oscillator.onended = () => {
        oscillator.disconnect();
        envelope.disconnect();
        this.voices.delete(oscillator);
      };
      oscillator.start(now);
      oscillator.stop(now + 1.2);
    }
  }

  dispose() {
    for (const voice of this.voices) {
      try {
        voice.stop();
      } catch {
        /* already ended */
      }
    }
    this.voices.clear();
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
