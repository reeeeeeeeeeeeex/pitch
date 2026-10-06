import { describe, expect, it } from 'vitest';
import { describePitch, type AnalysisFrame } from '../src/audio/analysis';
import { pitchHistoryScale } from '../src/audio/history-scale';

const frame = (hz: number, time: number) =>
  ({ time, pitch: describePitch(hz, 1) }) as AnalysisFrame;

describe('pitch history auto-ranging', () => {
  it('keeps a full octave glide in view instead of clipping the older notes', () => {
    const scale = pitchHistoryScale([frame(220, 1), frame(330, 2), frame(440, 3)], 3, null);
    expect(scale.low).toBeLessThan(57);
    expect(scale.high).toBeGreaterThan(69);
    expect((scale.high - scale.low) / scale.step).toBeLessThanOrEqual(6);
  });
  it('includes a distant reference without hiding the sung note', () => {
    const scale = pitchHistoryScale([frame(440, 1)], 1, 36);
    expect(scale.low).toBeLessThan(36);
    expect(scale.high).toBeGreaterThan(69);
  });
  it('ignores expired notes and provides a readable empty or steady range', () => {
    const scale = pitchHistoryScale([frame(65.406, 0), frame(440, 11)], 11, null);
    expect(scale.low).toBe(66);
    expect(scale.high).toBe(72);
    expect(pitchHistoryScale([], 0, null)).toEqual({ low: 57, high: 63, center: 60, step: 1 });
  });
});
