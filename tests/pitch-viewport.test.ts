import { describe, it, expect, vi } from 'vitest';
import {
  followPitchLow,
  clampPitchLow,
  PITCH_SPAN,
  PITCH_CHART_HEIGHT,
} from '../src/audio/pitch-viewport';
import { emptySession, HistoryStore } from '../src/audio/history';
import { describePitch, midiToHz, type AnalysisFrame } from '../src/audio/analysis';
import { encodeSession, decodeSession, DEFAULT_DISPLAY } from '../src/audio/archive';
import { drawTimePlot } from '../src/components/Timeline';

function frame(time: number, midi: number | null): AnalysisFrame {
  return {
    time,
    pitch: midi === null ? null : describePitch(midiToHz(midi), 1),
    sampleRate: 48000,
    waveform: new Float32Array(4096),
    spectrum: new Float32Array(4096).fill(-100),
    rmsDb: -20,
    peak: 0.3,
  };
}

describe('two-octave pitch viewport', () => {
  it('keeps vibrato and silence steady and follows changes before they leave the view', () => {
    let low = 48;
    for (const midi of [60, 60.2, 59.8, null]) expect(followPitchLow(low, midi)).toBe(low);
    for (let midi = 61; midi <= 82; midi += 0.25) {
      const next = followPitchLow(low, midi);
      expect(next - low).toBeLessThanOrEqual(1);
      expect(midi).toBeGreaterThanOrEqual(next + 5);
      expect(midi).toBeLessThanOrEqual(next + PITCH_SPAN - 5);
      low = next;
    }
    expect(followPitchLow(low, 40)).toBe(28);
    expect(followPitchLow(48, 108)).toBe(84);
    expect(clampPitchLow(-100)).toBe(21);
    expect(clampPitchLow(200)).toBe(84);
  });

  it('draws every semitone and octave label at readable spacing', () => {
    const labels: { text: string; y: number }[] = [];
    const context = new Proxy(
      {},
      {
        get: (_target, key) =>
          key === 'fillText'
            ? (text: string, _x: number, y: number) => labels.push({ text, y })
            : () => {},
      },
    ) as CanvasRenderingContext2D;
    drawTimePlot(
      context,
      800,
      PITCH_CHART_HEIGHT,
      emptySession(),
      { start: 0, end: 30 },
      'pitch',
      108,
      null,
      0,
      48,
    );
    const notes = labels.filter((label) => /^[A-G]♯?\d$/.test(label.text));
    expect(notes).toHaveLength(25);
    expect(notes[0].text).toBe('C3');
    expect(notes.at(-1)?.text).toBe('C5');
    for (let i = 1; i < notes.length; i++)
      expect(notes[i - 1].y - notes[i].y).toBeGreaterThanOrEqual(20);
  });

  it('finds the last voiced frame inside the time window without scanning silence or future frames', async () => {
    const history = new HistoryStore();
    for (let i = 0; i < 1000; i++)
      history.append(frame(i / 30, i === 50 ? 57 : i === 900 ? 69 : null));
    expect(history.latestPitch(0, 20)?.time).toBeCloseTo(50 / 30);
    expect(history.latestPitch(2, 20)).toBeNull();
    expect(history.latestPitch(2, 31)?.hz).toBeCloseTo(440);
    const restored = HistoryStore.fromBuffer(await history.toBlob().arrayBuffer(), 34);
    const get = vi.spyOn(restored, 'get');
    expect(restored.latestPitch(0, 29)?.hz).toBeCloseTo(220);
    expect(get.mock.calls.length).toBeLessThan(10);
  });

  it('roundtrips manual settings, defaults legacy sessions, and rejects invalid settings', async () => {
    const data = emptySession();
    data.duration = 1;
    data.history.append(frame(0.5, 60));
    const display = { ...DEFAULT_DISPLAY, pitchLow: 33, pitchFollowing: false };
    expect((await decodeSession(encodeSession(data, display))).display).toEqual(display);
    const { pitchLow: _low, pitchFollowing: _follow, ...legacy } = display;
    const imported = (await decodeSession(encodeSession(data, legacy))).display;
    expect(imported.pitchLow).toBe(48);
    expect(imported.pitchFollowing).toBe(true);
    for (const pitchLow of [20, 85, 48.5])
      await expect(decodeSession(encodeSession(data, { ...display, pitchLow }))).rejects.toThrow();
  });
});
