import { describePitch, FFT_SIZE, PITCH_SIZE } from './analysis';
import { PIANO_FIRST, PIANO_LAST } from './piano-notes';
import { DEFAULT_PITCH_LOW, PITCH_MIN_LOW, PITCH_MAX_LOW } from './pitch-viewport';
import {
  HistoryStore,
  EnvelopeStore,
  FRAME_BYTES,
  MAX_SECONDS,
  RECORD_RATE,
  type SessionData,
  type SavedDisplay,
} from './history';
const MAGIC = 'PITCHS01';
const MAX_FILE = 256 * 1024 * 1024;
export const DEFAULT_DISPLAY: SavedDisplay = {
  view: 'spectrum',
  windowSeconds: 30,
  target: null,
  milliseconds: 20,
  gain: 1,
  pitchLow: DEFAULT_PITCH_LOW,
  pitchFollowing: true,
};
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function encodeSession(data: SessionData, display: SavedDisplay) {
  const latest = data.latest;
  const blocks = [
    data.history.toBlob(),
    data.envelopes.toBlob(),
    data.wav ?? new Blob(),
    latest ? new Blob([latest.waveform, latest.spectrum]) : new Blob(),
  ];
  const manifest = new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      name: data.name,
      createdAt: data.createdAt,
      duration: data.duration,
      sampleRate: data.sampleRate,
      recorded: data.recorded,
      settings: data.settings,
      display,
      lengths: blocks.map((block) => block.size),
      latest: latest
        ? {
            time: latest.time,
            hz: latest.pitch?.hz ?? 0,
            clarity: latest.pitch?.clarity ?? 0,
            rmsDb: Math.max(-160, latest.rmsDb),
            peak: latest.peak,
          }
        : null,
    }),
  );
  const header = new Uint8Array(12);
  header.set(new TextEncoder().encode(MAGIC));
  new DataView(header.buffer).setUint32(8, manifest.length, true);
  return new Blob([header, manifest, ...blocks], { type: 'application/octet-stream' });
}
function fail(message: string): never {
  throw new Error(message);
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail('Invalid session manifest');
}
function number(value: unknown, low: number, high: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high
    ? value
    : fail('Invalid session value or time range');
}
export async function decodeSession(
  file: Blob,
): Promise<{ data: SessionData; display: SavedDisplay }> {
  if (file.size < 12 || file.size > MAX_FILE)
    fail('Session files must have a valid header and be no larger than 256 MiB');
  const header = await file.slice(0, 12).arrayBuffer();
  if (new TextDecoder().decode(header.slice(0, 8)) !== MAGIC)
    fail('Not a supported .pitchsession file');
  const manifestLength = new DataView(header).getUint32(8, true);
  if (!manifestLength || manifestLength > 65536 || manifestLength + 12 > file.size)
    fail('Invalid session manifest length');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.slice(12, 12 + manifestLength).text());
  } catch {
    fail('The session manifest is corrupted');
  }
  const m = object(parsed);
  if (m.version !== 1) fail('Unsupported session version');
  const duration = number(m.duration, 1 / RECORD_RATE, MAX_SECONDS);
  if (
    m.sampleRate !== RECORD_RATE ||
    typeof m.recorded !== 'boolean' ||
    typeof m.name !== 'string' ||
    m.name.length > 200 ||
    typeof m.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(m.createdAt))
  )
    fail('Invalid session metadata');
  if (
    !Array.isArray(m.lengths) ||
    m.lengths.length !== 4 ||
    m.lengths.some((value) => !Number.isSafeInteger(value) || value < 0)
  )
    fail('Invalid session block length');
  const lengths = m.lengths as number[];
  if (
    lengths.reduce((a, b) => a + b, 12 + manifestLength) !== file.size ||
    lengths[0] > 60000 * FRAME_BYTES ||
    lengths[1] > 180001 * 16 ||
    ![0, (PITCH_SIZE + FFT_SIZE / 2) * 4].includes(lengths[3])
  )
    fail('Session block lengths do not match');
  let offset = 12 + manifestLength;
  const blocks = lengths.map((length) => {
    const block = file.slice(offset, offset + length);
    offset += length;
    return block;
  });
  let wav: Blob | null = null;
  if (m.recorded) {
    if (blocks[2].size < 46) fail('Recording data is missing');
    const buffer = await blocks[2].slice(0, 44).arrayBuffer(),
      w = new DataView(buffer);
    const text = (start: number, end: number) => new TextDecoder().decode(buffer.slice(start, end));
    if (
      text(0, 4) !== 'RIFF' ||
      text(8, 12) !== 'WAVE' ||
      text(12, 16) !== 'fmt ' ||
      text(36, 40) !== 'data' ||
      w.getUint32(16, true) !== 16 ||
      w.getUint16(20, true) !== 1 ||
      w.getUint16(22, true) !== 1 ||
      w.getUint32(24, true) !== RECORD_RATE ||
      w.getUint32(28, true) !== RECORD_RATE * 2 ||
      w.getUint16(32, true) !== 2 ||
      w.getUint16(34, true) !== 16 ||
      w.getUint32(4, true) + 8 !== blocks[2].size ||
      w.getUint32(40, true) + 44 !== blocks[2].size ||
      (blocks[2].size - 44) % 2 ||
      Math.abs((blocks[2].size - 44) / 2 / RECORD_RATE - duration) > 1 / RECORD_RATE
    )
      fail('WAV format or recording duration does not match');
    wav = blocks[2].slice(0, blocks[2].size, 'audio/wav');
  } else if (blocks[2].size) fail('An analysis-only session cannot contain a recording');
  const history = HistoryStore.fromBuffer(await blocks[0].arrayBuffer(), duration);
  const envelopes = EnvelopeStore.fromBuffer(await blocks[1].arrayBuffer(), duration);
  let latest: SessionData['latest'] = null;
  if (lengths[3]) {
    const f = object(m.latest),
      time = number(f.time, 0, Math.min(MAX_SECONDS, duration + 0.000001)),
      hz = number(f.hz, 0, 24000),
      clarity = number(f.clarity, 0, 1),
      rmsDb = number(f.rmsDb, -160, 30),
      peak = number(f.peak, 0, 16);
    const buffer = await blocks[3].arrayBuffer(),
      waveform = new Float32Array(buffer.slice(0, PITCH_SIZE * 4)),
      spectrum = new Float32Array(buffer.slice(PITCH_SIZE * 4));
    if (
      waveform.some((v) => !Number.isFinite(v) || Math.abs(v) > 16) ||
      spectrum.some((v) => v !== -Infinity && (!Number.isFinite(v) || v < -1000 || v > 100))
    )
      fail('Invalid snapshot data');
    latest = {
      time,
      sampleRate: RECORD_RATE,
      waveform,
      spectrum,
      pitch: hz ? describePitch(hz, clarity) : null,
      rmsDb,
      peak,
    };
  } else if (m.latest !== null) fail('Snapshot data is missing');
  const d = object(m.display);
  const display: SavedDisplay = {
    view: ['spectrum', 'spectrogram', 'waveform'].includes(String(d.view))
      ? (d.view as SavedDisplay['view'])
      : 'spectrum',
    windowSeconds: [0, 10, 30, 60, 300].includes(Number(d.windowSeconds))
      ? Number(d.windowSeconds)
      : 30,
    target: d.target === null ? null : number(d.target, PIANO_FIRST, PIANO_LAST),
    milliseconds: [5, 10, 20, 50].includes(Number(d.milliseconds)) ? Number(d.milliseconds) : 20,
    gain: [1, 2, 4, 8].includes(Number(d.gain)) ? Number(d.gain) : 1,
    pitchLow:
      d.pitchLow === undefined
        ? DEFAULT_PITCH_LOW
        : number(d.pitchLow, PITCH_MIN_LOW, PITCH_MAX_LOW),
    pitchFollowing:
      d.pitchFollowing === undefined
        ? true
        : typeof d.pitchFollowing === 'boolean'
          ? d.pitchFollowing
          : fail('Invalid pitch-follow setting'),
  };
  if (!Number.isInteger(display.pitchLow)) fail('Invalid pitch display range');
  let settings: MediaTrackSettings | null = null;
  if (m.settings) {
    const s = object(m.settings);
    settings = {};
    for (const key of ['echoCancellation', 'noiseSuppression', 'autoGainControl'] as const)
      if (typeof s[key] === 'boolean') settings[key] = s[key];
    if (typeof s.sampleRate === 'number') settings.sampleRate = number(s.sampleRate, 8000, 384000);
  }
  return {
    data: {
      name: m.name.replace(/[\\/:*?"<>|]/g, '-'),
      createdAt: m.createdAt,
      duration,
      sampleRate: RECORD_RATE,
      recorded: m.recorded,
      wav,
      history,
      envelopes,
      latest,
      settings,
    },
    display,
  };
}
