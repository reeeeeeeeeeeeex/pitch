import { CEILING_DB, FLOOR_DB, FFT_SIZE, frequencyAt, type AnalysisFrame } from './analysis';

export const MAX_SECONDS = 1800;
export const RECORD_RATE = 48000;
export const BANDS = 512;
export const FRAME_BYTES = 24 + BANDS;
const CHUNK_FRAMES = 256;
export interface HistoryFrame {
  time: number;
  hz: number;
  clarity: number;
  rmsDb: number;
  peak: number;
  spectrum: Uint8Array<ArrayBuffer>;
  breakBefore?: boolean;
}
export interface Envelope {
  time: number;
  min: number;
  max: number;
}
export interface TimeRange {
  start: number;
  end: number;
}

export function formatTime(seconds: number, decimals = false) {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(safe % 60)
    .toString()
    .padStart(2, '0')}${
    decimals
      ? `.${Math.floor((safe % 1) * 100)
          .toString()
          .padStart(2, '0')}`
      : ''
  }`;
}
export function timeWindow(
  duration: number,
  seconds: number,
  following: boolean,
  start: number,
): TimeRange {
  const span = seconds === 0 ? Math.max(1, duration) : seconds;
  const left = following
    ? Math.max(0, duration - span)
    : Math.max(0, Math.min(start, Math.max(0, duration - span)));
  return { start: left, end: left + span };
}

export class HistoryStore {
  private chunks: ArrayBuffer[] = [];
  length = 0;
  private bandsForRate = 0;
  private ranges: [number, number][] = [];
  private pitchSegments: number[] = [];
  private voicedIndices: number[] = [];
  private indexSegment(index: number, hz: number, time: number) {
    if (hz) this.voicedIndices.push(index);
    const previous = index ? this.get(index - 1) : null;
    if (hz && (!previous?.hz || time - previous.time > 0.15)) this.pitchSegments.push(index);
  }
  get(index: number): HistoryFrame {
    if (index < 0 || index >= this.length) throw new RangeError('History index');
    const buffer = this.chunks[Math.floor(index / CHUNK_FRAMES)];
    const offset = (index % CHUNK_FRAMES) * FRAME_BYTES;
    const view = new DataView(buffer, offset, FRAME_BYTES);
    return {
      time: view.getFloat64(0, true),
      hz: view.getFloat32(8, true),
      clarity: view.getFloat32(12, true),
      rmsDb: view.getFloat32(16, true),
      peak: view.getFloat32(20, true),
      spectrum: new Uint8Array(buffer, offset + 24, BANDS),
    };
  }
  lowerBound(time: number) {
    let low = 0,
      high = this.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.get(mid).time < time) low = mid + 1;
      else high = mid;
    }
    return low;
  }
  latestPitch(start: number, end: number): HistoryFrame | null {
    let low = 0,
      high = this.voicedIndices.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.get(this.voicedIndices[mid]).time <= end) low = mid + 1;
      else high = mid;
    }
    const frame = low ? this.get(this.voicedIndices[low - 1]) : null;
    return frame && frame.time >= start ? frame : null;
  }
  near(time: number, cutoff = Infinity): HistoryFrame | null {
    if (time > cutoff) return null;
    const index = this.lowerBound(time);
    const candidate = index < this.length ? this.get(index) : null;
    const a = candidate && candidate.time <= cutoff ? candidate : null;
    const b = index > 0 ? this.get(index - 1) : null;
    const best = a && (!b || Math.abs(a.time - time) < Math.abs(b.time - time)) ? a : b;
    return best && Math.abs(best.time - time) <= 0.075 ? best : null;
  }
  *visible(range: TimeRange, maxPoints = Infinity): Generator<HistoryFrame> {
    const first = this.lowerBound(range.start),
      last = this.lowerBound(range.end + 0.000001);
    const step = Math.max(1, Math.ceil((last - first) / maxPoints));
    let low = 0,
      high = this.pitchSegments.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.pitchSegments[mid] < first) low = mid + 1;
      else high = mid;
    }
    let segment = low;
    for (let i = first; i < last; i += step) {
      let breakBefore = i === first;
      while (segment < this.pitchSegments.length && this.pitchSegments[segment] <= i) {
        breakBefore = true;
        segment++;
      }
      yield { ...this.get(i), breakBefore };
    }
  }
  append(frame: AnalysisFrame) {
    if (frame.time < 0 || frame.time > MAX_SECONDS || this.length >= 60000) return;
    if (this.length && frame.time <= this.get(this.length - 1).time) return;
    this.indexSegment(this.length, frame.pitch?.hz ?? 0, frame.time);
    if (this.bandsForRate !== frame.sampleRate) {
      this.bandsForRate = frame.sampleRate;
      this.ranges = Array.from({ length: BANDS }, (_, i) => [
        Math.max(0, Math.floor((frequencyAt(i / BANDS) * FFT_SIZE) / frame.sampleRate)),
        Math.min(
          frame.spectrum.length - 1,
          Math.ceil((frequencyAt((i + 1) / BANDS) * FFT_SIZE) / frame.sampleRate),
        ),
      ]);
    }
    if (this.length % CHUNK_FRAMES === 0)
      this.chunks.push(new ArrayBuffer(CHUNK_FRAMES * FRAME_BYTES));
    const offset = (this.length % CHUNK_FRAMES) * FRAME_BYTES;
    const view = new DataView(this.chunks.at(-1)!, offset, FRAME_BYTES);
    view.setFloat64(0, frame.time, true);
    view.setFloat32(8, frame.pitch?.hz ?? 0, true);
    view.setFloat32(12, frame.pitch?.clarity ?? 0, true);
    view.setFloat32(16, Math.max(-160, frame.rmsDb), true);
    view.setFloat32(20, frame.peak, true);
    this.ranges.forEach(([start, end], band) => {
      let db = FLOOR_DB;
      for (let bin = start; bin <= end; bin++) db = Math.max(db, frame.spectrum[bin]);
      view.setUint8(
        24 + band,
        Math.round(Math.max(0, Math.min(1, (db - FLOOR_DB) / (CEILING_DB - FLOOR_DB))) * 255),
      );
    });
    this.length++;
  }
  toBlob() {
    return new Blob(
      this.chunks.map(
        (buffer, i) =>
          new Uint8Array(
            buffer,
            0,
            Math.min(CHUNK_FRAMES, this.length - i * CHUNK_FRAMES) * FRAME_BYTES,
          ),
      ),
    );
  }
  static fromBuffer(buffer: ArrayBuffer, duration: number) {
    if (buffer.byteLength % FRAME_BYTES !== 0 || buffer.byteLength / FRAME_BYTES > 60000)
      throw new Error('Invalid spectrogram history length');
    const store = new HistoryStore();
    store.length = buffer.byteLength / FRAME_BYTES;
    for (let offset = 0; offset < buffer.byteLength; offset += CHUNK_FRAMES * FRAME_BYTES)
      store.chunks.push(buffer.slice(offset, offset + CHUNK_FRAMES * FRAME_BYTES));
    let previous = -1;
    for (let i = 0; i < store.length; i++) {
      const frame = store.get(i);
      if (
        ![frame.time, frame.hz, frame.clarity, frame.rmsDb, frame.peak].every(Number.isFinite) ||
        frame.time <= previous ||
        frame.time > duration + 0.000001 ||
        frame.time > MAX_SECONDS ||
        frame.time < 0 ||
        frame.hz < 0 ||
        frame.hz > 24000 ||
        frame.clarity < 0 ||
        frame.clarity > 1 ||
        frame.peak < 0 ||
        frame.peak > 16 ||
        frame.rmsDb < -160 ||
        frame.rmsDb > 30
      )
        throw new Error('Invalid spectrogram history data');
      previous = frame.time;
      store.indexSegment(i, frame.hz, frame.time);
    }
    return store;
  }
}

export class EnvelopeStore {
  // Higher levels keep min/max extrema rather than dropping transients in an overview.
  readonly levels: Envelope[][] = [[], [], [], [], [], []];
  append(value: Envelope) {
    if (value.time < 0 || value.time > MAX_SECONDS || this.levels[0].length >= 180001) return;
    if (this.levels[0].length && value.time <= this.levels[0].at(-1)!.time) return;
    this.levels[0].push(value);
    for (let level = 1; level < this.levels.length; level++) {
      const source = this.levels[level - 1],
        destination = this.levels[level];
      const index = Math.floor((source.length - 1) / 10);
      const begin = index * 10;
      let min = 1,
        max = -1;
      for (let i = begin; i < source.length; i++) {
        min = Math.min(min, source[i].min);
        max = Math.max(max, source[i].max);
      }
      destination[index] = { time: source.at(-1)!.time, min, max };
    }
  }
  *visible(range: TimeRange, pixels: number): Generator<Envelope> {
    let level = 0;
    while (
      level < this.levels.length - 1 &&
      ((range.end - range.start) * 100) / 10 ** level > pixels * 2
    )
      level++;
    const values = this.levels[level];
    let left = 0,
      right = values.length;
    while (left < right) {
      const mid = (left + right) >>> 1;
      if (values[mid].time < range.start) left = mid + 1;
      else right = mid;
    }
    for (
      let i = Math.max(0, left - 1);
      i < values.length && values[i].time <= range.end + 0.01 * 10 ** level;
      i++
    )
      yield values[i];
  }
  toBlob() {
    const buffer = new ArrayBuffer(this.levels[0].length * 16),
      view = new DataView(buffer);
    this.levels[0].forEach((point, i) => {
      view.setFloat64(i * 16, point.time, true);
      view.setFloat32(i * 16 + 8, point.min, true);
      view.setFloat32(i * 16 + 12, point.max, true);
    });
    return new Blob([buffer]);
  }
  static fromBuffer(buffer: ArrayBuffer, duration: number) {
    if (buffer.byteLength % 16 || buffer.byteLength / 16 > 180001)
      throw new Error('Invalid waveform data length');
    const store = new EnvelopeStore(),
      view = new DataView(buffer);
    let previous = -1;
    for (let offset = 0; offset < buffer.byteLength; offset += 16) {
      const point = {
        time: view.getFloat64(offset, true),
        min: view.getFloat32(offset + 8, true),
        max: view.getFloat32(offset + 12, true),
      };
      if (
        ![point.time, point.min, point.max].every(Number.isFinite) ||
        point.time <= previous ||
        point.time < 0 ||
        point.time > duration + 0.000001 ||
        point.time > MAX_SECONDS ||
        point.min > point.max ||
        point.min < -1 ||
        point.max > 1
      )
        throw new Error('Invalid waveform data');
      store.append(point);
      previous = point.time;
    }
    return store;
  }
}

export interface SavedDisplay {
  view: 'spectrum' | 'spectrogram' | 'waveform';
  windowSeconds: number;
  target: number | null;
  milliseconds: number;
  gain: number;
  pitchLow?: number;
  pitchFollowing?: boolean;
}
export interface SessionData {
  name: string;
  createdAt: string;
  duration: number;
  sampleRate: number;
  recorded: boolean;
  wav: Blob | null;
  history: HistoryStore;
  envelopes: EnvelopeStore;
  latest: AnalysisFrame | null;
  settings: MediaTrackSettings | null;
}
export function emptySession(recorded = false): SessionData {
  const date = new Date();
  return {
    name: `Pitch Studio-${date.toISOString().replace(/[:.]/g, '-').slice(0, 19)}`,
    createdAt: date.toISOString(),
    duration: 0,
    sampleRate: RECORD_RATE,
    recorded,
    wav: null,
    history: new HistoryStore(),
    envelopes: new EnvelopeStore(),
    latest: null,
    settings: null,
  };
}

export function wavHeader(samples: number, rate = RECORD_RATE) {
  const buffer = new ArrayBuffer(44),
    view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples * 2, true);
  return buffer;
}
