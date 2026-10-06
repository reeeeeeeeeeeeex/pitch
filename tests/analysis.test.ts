import { describe, expect, it } from 'vitest';
import {
  FFT_SIZE,
  PITCH_SIZE,
  PitchAnalysis,
  centsFrom,
  describePitch,
  frameAtTime,
  frequencyAt,
  frequencyRatio,
  measureLevel,
  midiToHz,
  noteName,
  pruneHistory,
  spectralPeaks,
  waveformStart,
  type AnalysisFrame,
} from '../src/audio/analysis';

function samples(hz: number, sampleRate = 48000, harmonic = false) {
  return Float32Array.from({ length: PITCH_SIZE }, (_, i) => {
    const phase = (2 * Math.PI * hz * i) / sampleRate;
    return harmonic
      ? 0.2 * Math.sin(phase) + 0.6 * Math.sin(2 * phase) + 0.1 * Math.sin(3 * phase)
      : 0.6 * Math.sin(phase);
  });
}

describe('fundamental pitch, independent from the loudest harmonic', () => {
  for (const sampleRate of [44100, 48000]) {
    for (const hz of [65.406, 110, 220, 440, 880, 2093]) {
      it(`${hz} Hz at ${sampleRate} samples/s is within five cents`, () => {
        const signal = samples(hz, sampleRate);
        const pitch = new PitchAnalysis().detect(signal, sampleRate, measureLevel(signal).rmsDb);
        expect(pitch).not.toBeNull();
        expect(Math.abs(centsFrom(pitch!.hz, hz))).toBeLessThan(5);
      });
    }
    it(`preserves 220 Hz when the 440 Hz harmonic is louder at ${sampleRate}`, () => {
      const signal = samples(220, sampleRate, true);
      const pitch = new PitchAnalysis().detect(signal, sampleRate, measureLevel(signal).rmsDb);
      expect(pitch!.midi).toBe(57);
      expect(Math.abs(centsFrom(pitch!.hz, 220))).toBeLessThan(5);
    });
  }
  it('does not invent a pitch for silence, low input, or deterministic white noise', () => {
    const analyser = new PitchAnalysis();
    expect(analyser.detect(new Float32Array(PITCH_SIZE), 48000, -Infinity)).toBeNull();
    expect(analyser.detect(samples(440), 48000, -70)).toBeNull();
    let seed = 17;
    const noise = Float32Array.from({ length: PITCH_SIZE }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0xffffffff - 0.5;
    });
    expect(analyser.detect(noise, 48000, measureLevel(noise).rmsDb)).toBeNull();
  });
  it('maps octaves and cents around A4 correctly', () => {
    expect(noteName(36)).toBe('C2');
    expect(noteName(96)).toBe('C7');
    expect(midiToHz(69)).toBe(440);
    const pitch = describePitch(440 * 2 ** (25 / 1200), 1);
    expect(pitch.midi).toBe(69);
    expect(pitch.cents).toBeCloseTo(25, 5);
  });
});

describe('frequency and time coordinates', () => {
  it('maps logarithmic frequency coordinates without sample-rate assumptions', () => {
    for (const hz of [50, 110, 440, 1000, 8000])
      expect(frequencyAt(frequencyRatio(hz))).toBeCloseTo(hz, 6);
  });
  it('detects separate peaks and orders them by strength', () => {
    const spectrum = new Float32Array(FFT_SIZE / 2).fill(-100);
    for (const [hz, db] of [
      [220, -20],
      [440, -10],
    ]) {
      const bin = Math.round((hz * FFT_SIZE) / 48000);
      spectrum[bin - 1] = db - 5;
      spectrum[bin] = db;
      spectrum[bin + 1] = db - 5;
    }
    const peaks = spectralPeaks(spectrum, 48000);
    expect(peaks).toHaveLength(2);
    expect(Math.abs(peaks[0].hz - 440)).toBeLessThan(48000 / FFT_SIZE);
    expect(Math.abs(peaks[1].hz - 220)).toBeLessThan(48000 / FFT_SIZE);
  });
  it('bounds history by real elapsed time and preserves gaps', () => {
    const frames = [0, 1, 5, 12].map((time) => ({ time }) as AnalysisFrame);
    pruneHistory(frames, 12);
    expect(frames.map((frame) => frame.time)).toEqual([5, 12]);
    expect(frameAtTime(frames, 8)).toBeNull();
    expect(frameAtTime(frames, 5.03)?.time).toBe(5);
    pruneHistory(frames, 23);
    expect(frames).toHaveLength(0);
  });
  it('stabilizes the waveform without reading beyond the buffer', () => {
    const wave = samples(220);
    const count = 960;
    const start = waveformStart(wave, count);
    expect(start + count).toBeLessThanOrEqual(wave.length);
    expect(wave[start - 1]).toBeLessThanOrEqual(0);
    expect(wave[start]).toBeGreaterThan(0);
    expect(waveformStart(wave, wave.length)).toBe(0);
  });
  it('measures actual RMS and peak, including clipping', () => {
    expect(measureLevel(new Float32Array([0, 0])).rmsDb).toBe(-Infinity);
    expect(measureLevel(new Float32Array([1, -1]))).toEqual({ rmsDb: 0, peak: 1 });
  });
});
