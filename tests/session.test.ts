import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  emptySession,
  HistoryStore,
  EnvelopeStore,
  timeWindow,
  wavHeader,
  RECORD_RATE,
} from '../src/audio/history';
import { encodeSession, decodeSession, DEFAULT_DISPLAY } from '../src/audio/archive';
import { describePitch, type AnalysisFrame } from '../src/audio/analysis';
const frame = (time: number): AnalysisFrame => ({
  time,
  sampleRate: 48000,
  waveform: new Float32Array(4096),
  spectrum: new Float32Array(4096).fill(-80),
  pitch: describePitch(220, 0.99),
  rmsDb: -20,
  peak: 0.3,
});
describe('long history and viewport', () => {
  it('does not let later frames change a frozen nearest-column lookup', () => {
    const store = new HistoryStore();
    store.append(frame(1));
    const frozen = store.near(1.02, 1.025);
    store.append(frame(1.03));
    expect(store.near(1.02, 1.025)).toEqual(frozen);
    expect(store.near(1.04, 1.025)).toBeNull();
  });
  it('retains the start, uses time windows, and leaves missing columns empty', () => {
    const store = new HistoryStore();
    for (let i = 0; i < 1800; i++) store.append(frame(i));
    expect(store.length).toBe(1800);
    expect(store.near(0)?.hz).toBe(220);
    expect(store.near(0.5)).toBeNull();
    expect([...store.visible({ start: 1700, end: 1710 })]).toHaveLength(11);
    expect(timeWindow(5, 30, true, 0)).toEqual({ start: 0, end: 30 });
    expect(timeWindow(90, 30, true, 0)).toEqual({ start: 60, end: 90 });
    expect(timeWindow(90, 30, false, 5)).toEqual({ start: 5, end: 35 });
    expect(timeWindow(90, 0, true, 0)).toEqual({ start: 0, end: 90 });
  });
  it('preserves pitch breaks even when overview sampling skips the gap', async () => {
    const store = new HistoryStore();
    for (let i = 0; i < 300; i++) {
      const f = frame(i / 30);
      if (i >= 120 && i <= 122) f.pitch = null;
      store.append(f);
    }
    const points = [...store.visible({ start: 0, end: 10 }, 20)];
    expect(points.filter((p) => p.breakBefore)).toHaveLength(2);
    const restored = HistoryStore.fromBuffer(await store.toBlob().arrayBuffer(), 10);
    expect([...restored.visible({ start: 0, end: 10 }, 20)]).toEqual(points);
  });
  it('keeps transients in coarse envelope levels', () => {
    const store = new EnvelopeStore();
    for (let i = 1; i <= 10000; i++)
      store.append({ time: i / 100, min: i === 1234 ? -1 : 0, max: i === 1234 ? 1 : 0 });
    const values = [...store.visible({ start: 0, end: 100 }, 10)];
    expect(values.some((v) => v.max === 1 && v.min === -1)).toBe(true);
    expect(values.length).toBeLessThan(30);
  });
});
describe('binary session', () => {
  async function fixture(recorded = false) {
    const data = emptySession(recorded);
    data.duration = 2;
    data.history.append(frame(0.5));
    data.history.append(frame(1.5));
    data.latest = frame(1.5);
    data.envelopes.append({ time: 1, min: -0.2, max: 0.3 });
    if (recorded) data.wav = new Blob([wavHeader(96000), new Int16Array(96000)]);
    return data;
  }
  it.each([false, true])('roundtrips recording=%s without base64', async (recorded) => {
    const data = await fixture(recorded);
    const blob = encodeSession(data, DEFAULT_DISPLAY);
    const result = await decodeSession(blob);
    expect(result.data.duration).toBe(2);
    expect(result.data.history.length).toBe(2);
    expect(result.data.history.get(1)).toEqual(data.history.get(1));
    expect(result.data.latest).toEqual(data.latest);
    expect(result.data.envelopes.levels[0][0].time).toBe(1);
    expect(result.data.wav?.size).toBe(data.wav?.size);
    if (data.wav)
      expect(await result.data.wav!.arrayBuffer()).toEqual(await data.wav.arrayBuffer());
  });
  it('rejects truncated, unsupported, and inconsistent files', async () => {
    const blob = encodeSession(await fixture(), DEFAULT_DISPLAY);
    await expect(decodeSession(blob.slice(0, blob.size - 1))).rejects.toThrow();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder().decode(
      bytes.slice(12, 12 + new DataView(bytes.buffer).getUint32(8, true)),
    );
    const change = (key: string, value: unknown) => {
      const m = JSON.parse(text);
      m[key] = value;
      const json = new TextEncoder().encode(JSON.stringify(m));
      const head = bytes.slice(0, 12);
      new DataView(head.buffer).setUint32(8, json.length, true);
      return new Blob([head, json, blob.slice(12 + new DataView(bytes.buffer).getUint32(8, true))]);
    };
    await expect(decodeSession(change('version', 2))).rejects.toThrow('version');
    await expect(decodeSession(change('duration', 1801))).rejects.toThrow();
    await expect(decodeSession(change('sampleRate', 44100))).rejects.toThrow();
  });
  it.each([21, 108])('roundtrips the expanded piano target %s', async (target) => {
    const blob = encodeSession(await fixture(), { ...DEFAULT_DISPLAY, target });
    expect((await decodeSession(blob)).display.target).toBe(target);
  });
  it('validates historical time ordering and envelope values', () => {
    const history = new HistoryStore();
    history.append(frame(1));
    const invalid = new ArrayBuffer(16);
    const view = new DataView(invalid);
    view.setFloat64(0, 1, true);
    view.setFloat32(8, -2, true);
    expect(() => EnvelopeStore.fromBuffer(invalid, 2)).toThrow();
  });
  it('rejects negative and out-of-session envelope timestamps', () => {
    for (const time of [-0.5, 2.1, 1800.01]) {
      const buffer = new ArrayBuffer(16);
      new DataView(buffer).setFloat64(0, time, true);
      expect(() => EnvelopeStore.fromBuffer(buffer, 2)).toThrow();
    }
  });
  it('encodes WAV with exactly 48 kHz mono signed PCM16 lengths', () => {
    const v = new DataView(wavHeader(48001));
    expect(v.getUint32(24, true)).toBe(RECORD_RATE);
    expect(v.getUint32(40, true)).toBe(96002);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint16(34, true)).toBe(16);
  });
});
describe('continuous audio worklet', () => {
  function processor(record = true) {
    const messages: any[] = [];
    let Constructor: any;
    const context = vm.createContext({
      sampleRate: 48000,
      currentFrame: 0,
      AudioWorkletProcessor: class {
        port = { onmessage: null, postMessage: (m: any) => messages.push(m) };
      },
      registerProcessor: (_name: string, c: any) => {
        Constructor = c;
      },
    });
    vm.runInContext(readFileSync('public/capture-worklet.js', 'utf8'), context);
    const p = new Constructor({ processorOptions: { record } });
    p.port.onmessage({ data: 'start' });
    return { p, messages };
  }
  it('flushes every final sample and partial envelope on stop', () => {
    const { p, messages } = processor();
    for (let i = 0; i < 400; i++) p.process([[new Float32Array(128).fill(0.25)]]);
    p.port.onmessage({ data: 'stop' });
    const pcm = messages.filter((m) => m.type === 'pcm');
    expect(pcm.reduce((n, m) => n + m.buffer.byteLength / 2, 0)).toBe(51200);
    expect(messages.at(-1).samples).toBe(51200);
    expect(messages.at(-1).reason).toBe('stopped');
    expect(new Int16Array(pcm.at(-1).buffer)[0]).toBe(8192);
  });
  it('stops at the exact sample limit, with no overwrite', () => {
    const { p, messages } = processor();
    p.samples = 86400000 - 64;
    p.process([[new Float32Array(128)]]);
    expect(messages.at(-1)).toMatchObject({ type: 'done', samples: 86400000, reason: 'limit' });
    expect(messages.find((m) => m.type === 'pcm').buffer.byteLength).toBe(128);
    const count = messages.length;
    p.process([[new Float32Array(128)]]);
    expect(messages.length).toBe(count);
  });
  it('analysis-only capture produces envelopes but no recording', () => {
    const { p, messages } = processor(false);
    for (let i = 0; i < 100; i++) p.process([[new Float32Array(128)]]);
    p.port.onmessage({ data: 'stop' });
    expect(messages.some((m) => m.type === 'pcm')).toBe(false);
    expect(messages.some((m) => m.type === 'envelope')).toBe(true);
  });
});
