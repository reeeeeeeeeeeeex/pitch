import { PIANO_FIRST, PIANO_LAST } from './piano-notes';

export const PITCH_SPAN = 24;
export const PITCH_MIN_LOW = PIANO_FIRST;
export const PITCH_MAX_LOW = PIANO_LAST - PITCH_SPAN;
export const DEFAULT_PITCH_LOW = 48; // C3–C5
export const PITCH_CHART_HEIGHT = 560;

export function clampPitchLow(low: number) {
  return Math.max(PITCH_MIN_LOW, Math.min(PITCH_MAX_LOW, Math.round(low)));
}

// Keep five semitones of headroom without chasing small vibrato movements.
export function followPitchLow(low: number, midi: number | null) {
  if (midi === null || !Number.isFinite(midi)) return low;
  if (midi < low || midi > low + PITCH_SPAN) return clampPitchLow(midi - PITCH_SPAN / 2);
  if (midi < low + 5) return clampPitchLow(Math.floor(midi) - 5);
  if (midi > low + PITCH_SPAN - 5) return clampPitchLow(Math.ceil(midi) - PITCH_SPAN + 5);
  return low;
}
