import { HISTORY_SECONDS, centsFrom, type AnalysisFrame } from './analysis';

/** Keep the whole visible phrase and its reference note inside the pitch plot. */
export function pitchHistoryScale(frames: AnalysisFrame[], endTime: number, target: number | null) {
  const pitches = frames
    .filter((frame) => frame.pitch && frame.time >= endTime - HISTORY_SECONDS)
    .map((frame) => 69 + centsFrom(frame.pitch!.hz, 440) / 100);
  const center = target ?? Math.round(pitches.at(-1) ?? 60);
  if (target !== null) pitches.push(target);
  if (!pitches.length) pitches.push(center);
  let low = Math.floor(Math.min(...pitches) - 1);
  let high = Math.ceil(Math.max(...pitches) + 1);
  if (high - low < 6) {
    low = Math.floor((high + low) / 2) - 3;
    high = low + 6;
  }
  return { low, high, center, step: Math.max(1, Math.ceil((high - low) / 6)) };
}
