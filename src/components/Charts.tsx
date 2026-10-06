import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { pitchHistoryScale } from '../audio/history-scale';
import {
  CEILING_DB,
  FFT_SIZE,
  FLOOR_DB,
  HISTORY_SECONDS,
  MAX_FREQUENCY,
  centsFrom,
  frameAtTime,
  frequencyAt,
  frequencyRatio,
  midiToHz,
  noteName,
  spectralPeaks,
  spectrumDbAt,
  waveformStart,
  type AnalysisFrame,
} from '../audio/analysis';

export type View = 'spectrum' | 'spectrogram' | 'waveform';
interface Size {
  width: number;
  height: number;
}
interface Plot {
  left: number;
  top: number;
  width: number;
  height: number;
}
const INK = '#c2ec88';
const MUTED = '#778176';
const GRID = '#2a302a';
const FONT = '11px "SFMono-Regular", Consolas, monospace';
const TICKS = [50, 100, 200, 500, 1000, 2000, 4000, 8000];
const formatHz = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : `${hz}`);

function useCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  return { ref, size };
}

function prepare(canvas: HTMLCanvasElement | null, size: Size) {
  if (!canvas || !size.width || !size.height) return null;
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(size.width * dpr);
  const height = Math.round(size.height * dpr);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size.width, size.height);
  ctx.font = FONT;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  return ctx;
}

function line(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color = GRID,
) {
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function frequencyGrid(ctx: CanvasRenderingContext2D, p: Plot, vertical: boolean, max: number) {
  ctx.fillStyle = MUTED;
  for (const hz of TICKS.filter((hz) => hz <= max)) {
    const ratio = frequencyRatio(hz, max);
    if (vertical) {
      const y = p.top + (1 - ratio) * p.height;
      line(ctx, p.left, y, p.left + p.width, y);
      ctx.textAlign = 'right';
      ctx.fillText(formatHz(hz), p.left - 10, y + 4);
    } else {
      const x = p.left + ratio * p.width;
      line(ctx, x, p.top, x, p.top + p.height);
      ctx.textAlign = 'center';
      ctx.fillText(formatHz(hz), x, p.top + p.height + 22);
    }
  }
}

function dbGrid(ctx: CanvasRenderingContext2D, p: Plot) {
  ctx.textAlign = 'right';
  ctx.fillStyle = MUTED;
  for (const db of [-20, -40, -60, -80, -100]) {
    const y = p.top + ((CEILING_DB - db) / (CEILING_DB - FLOOR_DB)) * p.height;
    line(ctx, p.left, y, p.left + p.width, y);
    ctx.fillText(String(db), p.left - 10, y + 4);
  }
}

function timeGrid(ctx: CanvasRenderingContext2D, p: Plot) {
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'center';
  for (let seconds = -10; seconds <= 0; seconds += 2) {
    const x = p.left + ((seconds + 10) / 10) * p.width;
    line(ctx, x, p.top, x, p.top + p.height);
    ctx.fillText(seconds === 0 ? '现在' : `${seconds}s`, x, p.top + p.height + 22);
  }
}

export function PitchHistory({
  frames,
  endTime,
  target,
}: {
  frames: AnalysisFrame[];
  endTime: number;
  target: number | null;
}) {
  const { ref, size } = useCanvas();
  useLayoutEffect(() => {
    const ctx = prepare(ref.current, size);
    if (!ctx) return;
    const p: Plot = {
      left: 43,
      top: 16,
      width: Math.max(1, size.width - 64),
      height: size.height - 44,
    };
    const { center, low, high, step } = pitchHistoryScale(frames, endTime, target);
    const yFor = (midi: number) => p.top + ((high - midi) / (high - low)) * p.height;
    ctx.fillStyle = MUTED;
    ctx.textAlign = 'right';
    for (let midi = Math.ceil(low / step) * step; midi <= high; midi += step) {
      const y = yFor(midi);
      line(ctx, p.left, y, p.left + p.width, y, midi === center ? '#46563c' : GRID);
      ctx.fillText(noteName(midi), p.left - 9, y + 4);
    }
    ctx.fillStyle = MUTED;
    ctx.textAlign = 'center';
    for (const t of [-10, -5, 0]) {
      const x = p.left + ((t + 10) / 10) * p.width;
      ctx.fillText(t === 0 ? '现在' : `${t}s`, x, p.top + p.height + 22);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.left, p.top, p.width, p.height);
    ctx.clip();
    if (target !== null) {
      ctx.setLineDash([4, 5]);
      line(ctx, p.left, yFor(target), p.left + p.width, yFor(target), '#b6a2ee');
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let previous: AnalysisFrame | null = null;
    for (const frame of frames) {
      if (frame.time < endTime - HISTORY_SECONDS || !frame.pitch) {
        previous = null;
        continue;
      }
      const x = p.left + ((frame.time - endTime + HISTORY_SECONDS) / HISTORY_SECONDS) * p.width;
      const midi = 69 + centsFrom(frame.pitch.hz, 440) / 100;
      const y = yFor(midi);
      if (previous && frame.time - previous.time < 0.15) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      previous = frame;
    }
    ctx.stroke();
    ctx.restore();
  }, [frames, endTime, target, size, ref]);
  return (
    <canvas
      className="pitch-history"
      ref={ref}
      role="img"
      aria-label="最近十秒的音高曲线；无稳定音高的片段留空"
    />
  );
}

// An immutable frame can reuse its color column when other frames arrive.
const columnCache = new WeakMap<
  AnalysisFrame,
  { height: number; max: number; canvas: HTMLCanvasElement }
>();
const COLOR_STOPS = [
  [15, 22, 23],
  [35, 58, 75],
  [57, 104, 112],
  [99, 163, 138],
  [190, 225, 131],
  [245, 226, 156],
];
function colorFor(db: number): number[] {
  const t =
    Math.min(1, Math.max(0, (db - FLOOR_DB) / (CEILING_DB - FLOOR_DB))) * (COLOR_STOPS.length - 1);
  const index = Math.min(COLOR_STOPS.length - 2, Math.floor(t));
  return COLOR_STOPS[index].map((value, channel) =>
    Math.round(value + (COLOR_STOPS[index + 1][channel] - value) * (t - index)),
  );
}

function spectrumColumn(frame: AnalysisFrame, height: number, max: number) {
  const cached = columnCache.get(frame);
  if (cached?.height === height && cached.max === max) return cached.canvas;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const pixels = ctx.createImageData(1, height);
  const binWidth = frame.sampleRate / FFT_SIZE;
  for (let y = 0; y < height; y++) {
    const low = Math.max(1, Math.floor(frequencyAt(1 - (y + 1) / height, max) / binWidth));
    const high = Math.min(
      frame.spectrum.length - 1,
      Math.ceil(frequencyAt(1 - y / height, max) / binWidth),
    );
    let db = -Infinity;
    for (let bin = low; bin <= high; bin++) db = Math.max(db, frame.spectrum[bin]);
    const color = colorFor(db);
    pixels.data.set([...color, 255], y * 4);
  }
  ctx.putImageData(pixels, 0, 0);
  columnCache.set(frame, { height, max, canvas });
  return canvas;
}

export function AnalysisChart({
  view,
  frame,
  frames,
  endTime,
  milliseconds,
  gain,
  frozen,
  running,
}: {
  view: View;
  frame: AnalysisFrame | null;
  frames: AnalysisFrame[];
  endTime: number;
  milliseconds: number;
  gain: number;
  frozen: boolean;
  running: boolean;
}) {
  const { ref, size } = useCanvas();
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [tooltip, setTooltip] = useState('');
  const max = Math.min(MAX_FREQUENCY, frame ? frame.sampleRate / 2 : MAX_FREQUENCY);
  useLayoutEffect(() => {
    const ctx = prepare(ref.current, size);
    if (!ctx) return;
    const p: Plot = {
      left: 49,
      top: 24,
      width: Math.max(1, size.width - 75),
      height: Math.max(1, size.height - 62),
    };
    ctx.fillStyle = MUTED;
    ctx.textAlign = 'left';
    ctx.fillText(view === 'waveform' ? '振幅' : view === 'spectrum' ? 'dB' : 'Hz', 8, 13);
    if (view === 'spectrum') {
      frequencyGrid(ctx, p, false, max);
      dbGrid(ctx, p);
      ctx.textAlign = 'right';
      ctx.fillText('Hz', size.width - 4, size.height - 16);
      if (frame) {
        const yFor = (db: number) =>
          p.top + Math.max(0, Math.min(1, (CEILING_DB - db) / (CEILING_DB - FLOOR_DB))) * p.height;
        ctx.save();
        ctx.beginPath();
        ctx.rect(p.left, p.top, p.width, p.height);
        ctx.clip();
        if (frame.pitch) {
          for (let harmonic = 1; harmonic <= 16; harmonic++) {
            const hz = harmonic * frame.pitch.hz;
            if (hz > max) break;
            const x = p.left + frequencyRatio(hz, max) * p.width;
            ctx.setLineDash([3, 5]);
            line(ctx, x, p.top, x, p.top + p.height, harmonic === 1 ? '#79975b' : '#46513e');
            ctx.setLineDash([]);
            ctx.fillStyle = harmonic === 1 ? INK : '#829272';
            ctx.textAlign = 'center';
            if (harmonic <= 8)
              ctx.fillText(harmonic === 1 ? '基频' : `${harmonic}×`, x, p.top + 12);
          }
        }
        const gradient = ctx.createLinearGradient(0, p.top, 0, p.top + p.height);
        gradient.addColorStop(0, '#b9e97a40');
        gradient.addColorStop(1, '#b9e97a02');
        ctx.beginPath();
        ctx.moveTo(p.left, p.top + p.height);
        for (let pixel = 0; pixel <= p.width; pixel++) {
          const start = Math.floor(
            (frequencyAt(pixel / p.width, max) * FFT_SIZE) / frame.sampleRate,
          );
          const end = Math.min(
            frame.spectrum.length - 1,
            Math.ceil((frequencyAt((pixel + 1) / p.width, max) * FFT_SIZE) / frame.sampleRate),
          );
          let db = FLOOR_DB;
          for (let i = Math.max(0, start); i <= end; i++) db = Math.max(db, frame.spectrum[i]);
          ctx.lineTo(p.left + pixel, yFor(db));
        }
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.7;
        ctx.stroke();
        ctx.lineTo(p.left + p.width, p.top + p.height);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();
        for (const peak of spectralPeaks(frame.spectrum, frame.sampleRate, 3)) {
          const x = p.left + frequencyRatio(peak.hz, max) * p.width;
          const y = yFor(peak.db);
          ctx.fillStyle = INK;
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    } else if (view === 'spectrogram') {
      ctx.save();
      ctx.beginPath();
      ctx.rect(p.left, p.top, p.width, p.height);
      ctx.clip();
      for (let index = 0; index < frames.length; index++) {
        const item = frames[index];
        const x = p.left + ((item.time - endTime + HISTORY_SECONDS) / HISTORY_SECONDS) * p.width;
        const next = frames[index + 1];
        const duration = next ? Math.min(0.075, next.time - item.time) : 1 / 30;
        const columnWidth = Math.max(1, (duration / HISTORY_SECONDS) * p.width);
        if (x + columnWidth < p.left || x > p.left + p.width) continue;
        ctx.drawImage(
          spectrumColumn(item, Math.ceil(p.height), max),
          x,
          p.top,
          columnWidth,
          p.height,
        );
      }
      ctx.restore();
      frequencyGrid(ctx, p, true, max);
      timeGrid(ctx, p);
    } else {
      ctx.textAlign = 'right';
      ctx.fillStyle = MUTED;
      for (const amplitude of [-1, -0.5, 0, 0.5, 1]) {
        const y = p.top + ((1 - amplitude) / 2) * p.height;
        line(ctx, p.left, y, p.left + p.width, y, amplitude === 0 ? '#526048' : GRID);
        ctx.fillText(String(amplitude / gain), p.left - 10, y + 4);
      }
      ctx.textAlign = 'center';
      for (let tick = 0; tick <= 4; tick++) {
        const x = p.left + (tick / 4) * p.width;
        line(ctx, x, p.top, x, p.top + p.height);
        ctx.fillText(`${(milliseconds * tick) / 4}`, x, p.top + p.height + 22);
      }
      ctx.textAlign = 'right';
      ctx.fillText('ms', size.width - 3, size.height - 16);
      if (frame) {
        const count = Math.min(
          frame.waveform.length,
          Math.round((frame.sampleRate * milliseconds) / 1000),
        );
        const start = waveformStart(frame.waveform, count);
        ctx.save();
        ctx.beginPath();
        ctx.rect(p.left, p.top, p.width, p.height);
        ctx.clip();
        ctx.beginPath();
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = '#a7d5e1';
        for (let i = 0; i < count; i++) {
          const x = p.left + (i / Math.max(1, count - 1)) * p.width;
          const y = p.top + ((1 - frame.waveform[start + i] * gain) / 2) * p.height;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      }
    }
    let text = '';
    if (
      cursor &&
      cursor.x >= p.left &&
      cursor.x <= p.left + p.width &&
      cursor.y >= p.top &&
      cursor.y <= p.top + p.height
    ) {
      ctx.setLineDash([3, 3]);
      line(ctx, cursor.x, p.top, cursor.x, p.top + p.height, '#8e9a83');
      ctx.setLineDash([]);
      const ratioX = (cursor.x - p.left) / p.width;
      if (view === 'spectrum' && frame) {
        const hz = frequencyAt(ratioX, max);
        const db = spectrumDbAt(frame, hz);
        text = `${hz.toFixed(1)} Hz · ${Number.isFinite(db) ? db.toFixed(1) : '−∞'} dB`;
      } else if (view === 'spectrogram') {
        const time = endTime - HISTORY_SECONDS + ratioX * HISTORY_SECONDS;
        const hz = frequencyAt(1 - (cursor.y - p.top) / p.height, max);
        const selected = frameAtTime(frames, time);
        const db = selected ? spectrumDbAt(selected, hz) : null;
        text = `${(time - endTime).toFixed(2)} s · ${hz.toFixed(0)} Hz · ${db === null ? '无采样' : Number.isFinite(db) ? `${db.toFixed(1)} dB` : '−∞ dB'}`;
      } else if (view === 'waveform' && frame) {
        const count = Math.min(
          frame.waveform.length,
          Math.round((frame.sampleRate * milliseconds) / 1000),
        );
        const index =
          waveformStart(frame.waveform, count) +
          Math.min(count - 1, Math.round(ratioX * (count - 1)));
        text = `${(ratioX * milliseconds).toFixed(2)} ms · 振幅 ${frame.waveform[index].toFixed(4)}`;
      }
    }
    setTooltip((previous) => (previous === text ? previous : text));
  }, [view, frame, frames, endTime, milliseconds, gain, cursor, max, ref, size]);

  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setCursor({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  };
  return (
    <div className="chart-wrap">
      <canvas
        ref={ref}
        className="analysis-canvas"
        onPointerMove={move}
        onPointerLeave={() => setCursor(null)}
        role="img"
        aria-label={
          view === 'spectrum'
            ? '实时频谱图，横轴频率，纵轴相对强度'
            : view === 'spectrogram'
              ? '最近十秒声谱图，颜色表示频率强度'
              : '实时声音波形，横轴毫秒，纵轴振幅'
        }
      />
      {!frame && (
        <div className="chart-empty">
          <span className="empty-cross">＋</span>
          <p>{running ? '正在等待音频输入' : '让你的声音出现在这里'}</p>
          <span>{running ? '对着麦克风说话或唱一个长音' : '开启麦克风，开始实时观察'}</span>
        </div>
      )}
      {tooltip && (
        <div className="chart-tooltip" role="status">
          {tooltip}
        </div>
      )}
      {frozen && <span className="frozen-tag">画面已冻结</span>}
    </div>
  );
}

export function targetDeviation(frame: AnalysisFrame | null, target: number | null): number | null {
  return frame?.pitch
    ? target === null
      ? frame.pitch.cents
      : centsFrom(frame.pitch.hz, midiToHz(target))
    : null;
}
