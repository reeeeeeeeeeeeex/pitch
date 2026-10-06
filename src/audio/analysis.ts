import { PitchDetector } from 'pitchy';

export const HISTORY_SECONDS = 10;
export const PITCH_SIZE = 4096;
export const FFT_SIZE = 8192;
export const MIN_FREQUENCY = 50;
export const MAX_FREQUENCY = 8000;
export const FLOOR_DB = -100;
export const CEILING_DB = -15;
const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export interface Pitch {
  hz: number;
  clarity: number;
  midi: number;
  note: string;
  octave: number;
  cents: number;
}

export interface AnalysisFrame {
  time: number;
  sampleRate: number;
  waveform: Float32Array<ArrayBuffer>;
  spectrum: Float32Array<ArrayBuffer>;
  pitch: Pitch | null;
  rmsDb: number;
  peak: number;
}

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function noteName(midi: number): string {
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export function centsFrom(hz: number, reference: number): number {
  return 1200 * Math.log2(hz / reference);
}

export function describePitch(hz: number, clarity: number): Pitch {
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return {
    hz,
    clarity,
    midi,
    note: NAMES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
    cents: centsFrom(hz, midiToHz(midi)),
  };
}

export function measureLevel(samples: Float32Array): { rmsDb: number; peak: number } {
  let sum = 0;
  let peak = 0;
  for (const value of samples) {
    sum += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  const rms = Math.sqrt(sum / Math.max(samples.length, 1));
  return { rmsDb: rms > 0 ? 20 * Math.log10(rms) : -Infinity, peak };
}

export class PitchAnalysis {
  private detector = PitchDetector.forFloat32Array(PITCH_SIZE);

  detect(samples: Float32Array, sampleRate: number, rmsDb: number): Pitch | null {
    if (rmsDb < -60) return null;
    const [hz, clarity] = this.detector.findPitch(samples, sampleRate);
    if (!Number.isFinite(hz) || clarity < 0.9 || hz < 60 || hz > 2200) return null;
    return describePitch(hz, clarity);
  }
}

export interface SpectralPeak {
  hz: number;
  db: number;
}

export function spectralPeaks(data: Float32Array, sampleRate: number, limit = 5): SpectralPeak[] {
  const binWidth = sampleRate / FFT_SIZE;
  const peaks: SpectralPeak[] = [];
  const end = Math.min(data.length - 1, Math.floor(MAX_FREQUENCY / binWidth));
  for (let i = Math.max(1, Math.ceil(MIN_FREQUENCY / binWidth)); i < end; i++) {
    if (data[i] <= -80 || data[i] <= data[i - 1] || data[i] < data[i + 1]) continue;
    // Parabolic interpolation refines a local peak, without identifying it as a fundamental.
    const denominator = data[i - 1] - 2 * data[i] + data[i + 1];
    const offset =
      Number.isFinite(denominator) && Math.abs(denominator) > 1e-8
        ? Math.max(-0.5, Math.min(0.5, (0.5 * (data[i - 1] - data[i + 1])) / denominator))
        : 0;
    peaks.push({ hz: (i + offset) * binWidth, db: data[i] });
  }
  return peaks.sort((a, b) => b.db - a.db).slice(0, limit);
}

export function frequencyAt(ratio: number, max = MAX_FREQUENCY): number {
  return MIN_FREQUENCY * (max / MIN_FREQUENCY) ** ratio;
}

export function frequencyRatio(hz: number, max = MAX_FREQUENCY): number {
  return Math.log(hz / MIN_FREQUENCY) / Math.log(max / MIN_FREQUENCY);
}

export function spectrumDbAt(frame: AnalysisFrame, hz: number): number {
  const bin = Math.round((hz * FFT_SIZE) / frame.sampleRate);
  return frame.spectrum[Math.min(frame.spectrum.length - 1, Math.max(0, bin))];
}

export function pruneHistory(frames: AnalysisFrame[], now: number): void {
  const cutoff = now - HISTORY_SECONDS;
  let remove = 0;
  while (remove < frames.length && frames[remove].time < cutoff) remove++;
  if (remove) frames.splice(0, remove);
  // Bound memory even if a device clock behaves unexpectedly.
  if (frames.length > 360) frames.splice(0, frames.length - 360);
}

export function frameAtTime(frames: AnalysisFrame[], time: number): AnalysisFrame | null {
  let best: AnalysisFrame | null = null;
  let distance = 0.075;
  for (const frame of frames) {
    const diff = Math.abs(frame.time - time);
    if (diff < distance) {
      best = frame;
      distance = diff;
    }
  }
  return best;
}

export function waveformStart(samples: Float32Array, count: number): number {
  // A positive-going zero crossing stabilizes periodic input without modifying the samples.
  const end = Math.max(0, samples.length - count);
  for (let i = 1; i < end; i++) {
    if (samples[i - 1] <= 0 && samples[i] > 0) return i;
  }
  return 0;
}
