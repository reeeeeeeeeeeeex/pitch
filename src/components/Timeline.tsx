import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { frequencyAt, frequencyRatio, noteName } from '../audio/analysis';
import { formatTime, type SessionData, type TimeRange } from '../audio/history';
import { downloadBlob } from '../audio/archive';
import {
  DEFAULT_PITCH_LOW,
  PITCH_SPAN,
  PITCH_CHART_HEIGHT,
  followPitchLow,
} from '../audio/pitch-viewport';
export type TimePlot = 'pitch' | 'spectrogram' | 'waveform';
const LEFT = 62,
  RIGHT = 24,
  TOP = 24,
  BOTTOM = 32;
const colors = Array.from({ length: 256 }, (_, i) => {
  const stops = [
    [15, 23, 25],
    [34, 73, 88],
    [53, 126, 119],
    [169, 209, 113],
    [255, 223, 147],
  ];
  const n = (i / 255) * 4,
    a = Math.min(3, Math.floor(n)),
    t = n - a;
  return stops[a].map((v, c) => Math.round(v + (stops[a + 1][c] - v) * t));
});
export function drawTimePlot(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  data: SessionData,
  range: TimeRange,
  kind: TimePlot,
  target: number | null,
  cursor: number | null,
  cutoff = data.duration,
  pitchLow = DEFAULT_PITCH_LOW,
) {
  ctx.save();
  ctx.fillStyle = '#161c18';
  ctx.fillRect(0, 0, width, height);
  ctx.font = '11px Consolas, monospace';
  const w = Math.max(1, width - LEFT - RIGHT),
    h = Math.max(1, height - TOP - BOTTOM),
    span = Math.max(0.001, range.end - range.start);
  const x = (time: number) => LEFT + ((time - range.start) / span) * w;
  const line = (x1: number, y1: number, x2: number, y2: number, color = '#303b32') => {
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  if (kind === 'spectrogram') {
    const columns = Math.max(1, Math.floor(w)),
      rows = Math.max(1, Math.floor(h));
    const image = ctx.createImageData(columns, rows);
    for (let px = 0; px < columns; px++) {
      const frame = data.history.near(range.start + ((px + 0.5) / columns) * span, cutoff);
      if (!frame || frame.time > cutoff) continue;
      for (let py = 0; py < rows; py++) {
        const value = frame.spectrum[Math.min(511, Math.floor((1 - (py + 0.5) / rows) * 512))],
          color = colors[value],
          i = (py * columns + px) * 4;
        image.data[i] = color[0];
        image.data[i + 1] = color[1];
        image.data[i + 2] = color[2];
        image.data[i + 3] = 255;
      }
    }
    // putImageData ignores transforms, so render the pixel buffer through a bounded scratch canvas.
    const scratch = document.createElement('canvas');
    scratch.width = columns;
    scratch.height = rows;
    scratch.getContext('2d')!.putImageData(image, 0, 0);
    ctx.drawImage(scratch, LEFT, TOP, w, h);
    ctx.fillStyle = '#a3afa1';
    ctx.textAlign = 'right';
    for (const hz of [50, 100, 200, 500, 1000, 2000, 4000, 8000]) {
      const y = TOP + (1 - frequencyRatio(hz)) * h;
      line(LEFT, y, LEFT + w, y, '#77817640');
      ctx.fillText(hz >= 1000 ? `${hz / 1000}k` : String(hz), LEFT - 8, y + 4);
    }
    ctx.fillText('Hz', LEFT - 8, 13);
  } else if (kind === 'pitch') {
    const low = pitchLow,
      high = low + PITCH_SPAN;
    const frames = Array.from(
      data.history.visible({ start: range.start, end: Math.min(range.end, cutoff) }, w * 2),
    );
    const y = (midi: number) => TOP + ((high - midi) / (high - low)) * h;
    ctx.textAlign = 'right';
    for (let midi = low; midi <= high; midi++) {
      const octave = midi % 12 === 0;
      ctx.fillStyle = octave ? '#d9e9ca' : '#a3afa1';
      line(LEFT, y(midi), LEFT + w, y(midi), octave ? '#566449' : '#303b32');
      ctx.fillText(noteName(midi), LEFT - 8, y(midi) + 4);
    }
    if (target !== null && target >= low && target <= high) {
      ctx.setLineDash([4, 4]);
      line(LEFT, y(target), LEFT + w, y(target), '#eac18c');
      ctx.setLineDash([]);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(LEFT, TOP, w, h);
    ctx.clip();
    ctx.strokeStyle = '#c2ec88';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    let previous = -Infinity;
    for (const f of frames) {
      if (!f.hz) {
        previous = -Infinity;
        continue;
      }
      const py = y(69 + 12 * Math.log2(f.hz / 440));
      if (f.breakBefore || f.time - previous > Math.max(0.15, (span / w) * 2))
        ctx.moveTo(x(f.time), py);
      else ctx.lineTo(x(f.time), py);
      previous = f.time;
    }
    ctx.stroke();
    ctx.restore();
  } else {
    const y = (value: number) => TOP + ((1 - value) / 2) * h;
    ctx.fillStyle = '#a3afa1';
    ctx.textAlign = 'right';
    for (const value of [-1, 0, 1]) {
      line(LEFT, y(value), LEFT + w, y(value));
      ctx.fillText(String(value), LEFT - 8, y(value) + 4);
    }
    ctx.textAlign = 'left';
    ctx.fillText('Amplitude', 8, 13);
    ctx.save();
    ctx.beginPath();
    ctx.rect(LEFT, TOP, w, h);
    ctx.clip();
    ctx.strokeStyle = '#9bc5a1';
    ctx.beginPath();
    for (const p of data.envelopes.visible(range, w)) {
      if (p.time > cutoff) continue;
      ctx.moveTo(x(p.time), y(p.min));
      ctx.lineTo(x(p.time), y(p.max));
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = '#a3afa1';
  ctx.textAlign = 'center';
  const ticks = Math.max(2, Math.floor(w / 100));
  for (let i = 0; i <= ticks; i++) {
    const time = range.start + (i / ticks) * span;
    line(x(time), TOP, x(time), TOP + h, '#77817625');
    ctx.fillText(formatTime(time, span / ticks < 1), x(time), height - 10);
  }
  if (cursor !== null && cursor >= range.start && cursor <= range.end) {
    line(x(cursor), TOP, x(cursor), TOP + h, '#f4cd90');
    ctx.fillStyle = '#f4cd90';
    ctx.fillText(
      formatTime(cursor, true),
      Math.max(LEFT + 30, Math.min(width - 50, x(cursor))),
      13,
    );
  }
  ctx.restore();
}
export function TimeChart({
  data,
  range,
  kind,
  target = null,
  cursor = null,
  revision,
  onSeek,
  compact = false,
  cutoff = data.duration,
  pitchLow = DEFAULT_PITCH_LOW,
  onPitchPan,
  onPitchDragChange,
}: {
  data: SessionData;
  range: TimeRange;
  kind: TimePlot;
  target?: number | null;
  cursor?: number | null;
  revision: number;
  compact?: boolean;
  cutoff?: number;
  onSeek?: (time: number) => void;
  pitchLow?: number;
  onPitchPan?: (low: number) => void;
  onPitchDragChange?: (dragging: boolean) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null),
    [width, setWidth] = useState(600),
    [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ pointer: number; y: number; low: number } | null>(null);
  const ignoreClick = useRef(false);
  const wheelRemainder = useRef(0);
  const height = compact ? 80 : kind === 'pitch' ? PITCH_CHART_HEIGHT : 290;
  useEffect(() => {
    if (kind !== 'pitch' || !onPitchPan) return;
    const canvas = ref.current!;
    const wheel = (event: WheelEvent) => {
      if (!event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      const delta =
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
      if (Math.sign(delta) !== Math.sign(wheelRemainder.current)) wheelRemainder.current = 0;
      wheelRemainder.current += delta;
      const steps = Math.trunc(wheelRemainder.current / 40);
      if (steps) {
        wheelRemainder.current -= steps * 40;
        onPitchPan(pitchLow - steps);
      }
    };
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => canvas.removeEventListener('wheel', wheel);
  }, [kind, onPitchPan, pitchLow, height]);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const canvas = ref.current!,
      dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    drawTimePlot(ctx, width, height, data, range, kind, target, cursor, cutoff, pitchLow);
  }, [
    data,
    range.start,
    range.end,
    kind,
    width,
    height,
    target,
    cursor,
    revision,
    cutoff,
    pitchLow,
  ]);
  const timeAt = (clientX: number) =>
    Math.max(
      range.start,
      Math.min(
        range.end,
        range.start +
          ((clientX - ref.current!.getBoundingClientRect().left - LEFT) /
            Math.max(1, width - LEFT - RIGHT)) *
            (range.end - range.start),
      ),
    );
  return (
    <div className="time-chart">
      <canvas
        ref={ref}
        className={kind === 'pitch' ? 'pitch-pan-canvas' : undefined}
        tabIndex={kind === 'pitch' ? 0 : undefined}
        style={{ width: '100%', height }}
        data-testid={`time-${kind}`}
        aria-label={
          kind === 'pitch'
            ? `Session pitch trace, ${noteName(pitchLow)} to ${noteName(pitchLow + PITCH_SPAN)}, one semitone per line`
            : kind === 'spectrogram'
              ? 'Session spectrogram'
              : 'Continuous waveform overview'
        }
        onKeyDown={(event) => {
          if (!onPitchPan) return;
          const delta = (
            { ArrowUp: 1, ArrowDown: -1, PageUp: 12, PageDown: -12 } as Record<string, number>
          )[event.key];
          if (delta) {
            event.preventDefault();
            onPitchPan(pitchLow + delta);
          }
        }}
        onPointerDown={(event) => {
          ignoreClick.current = false;
          if (kind !== 'pitch' || !onPitchPan || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { pointer: event.pointerId, y: event.clientY, low: pitchLow };
        }}
        onPointerUp={() => {
          drag.current = null;
          onPitchDragChange?.(false);
        }}
        onPointerCancel={() => {
          drag.current = null;
          ignoreClick.current = true;
          onPitchDragChange?.(false);
        }}
        onLostPointerCapture={() => {
          drag.current = null;
          onPitchDragChange?.(false);
        }}
        onClick={(event) => {
          if (!ignoreClick.current) onSeek?.(timeAt(event.clientX));
          ignoreClick.current = false;
        }}
        onPointerLeave={() => setHover(null)}
        onPointerMove={(event) => {
          if (drag.current && onPitchPan && drag.current.pointer === event.pointerId) {
            const dy = event.clientY - drag.current.y;
            if (Math.abs(dy) > 4 || ignoreClick.current) {
              onPitchDragChange?.(true);
              ignoreClick.current = true;
              onPitchPan(drag.current.low + (dy / (height - TOP - BOTTOM)) * PITCH_SPAN);
              setHover(null);
              return;
            }
          }
          const time = timeAt(event.clientX);
          const candidate = data.history.near(time, cutoff);
          const frame = candidate && candidate.time <= cutoff ? candidate : null;
          const hz = frequencyAt(
            Math.max(
              0,
              Math.min(
                1,
                1 -
                  (event.clientY - ref.current!.getBoundingClientRect().top - TOP) /
                    (height - TOP - BOTTOM),
              ),
            ),
          );
          setHover(
            `${formatTime(time, true)}${kind === 'pitch' ? (frame?.hz ? ` · ${noteName(Math.round(69 + 12 * Math.log2(frame.hz / 440)))} · ${frame.hz.toFixed(1)} Hz` : ' · No steady pitch') : kind === 'spectrogram' ? ` · ${hz.toFixed(0)} Hz · ${frame ? (-100 + (frame.spectrum[Math.min(511, Math.floor(frequencyRatio(hz) * 512))] / 255) * 85).toFixed(1) + ' dB' : 'No analysis data'}` : ''}`,
          );
        }}
      />
      {hover && <span className="time-tooltip">{hover}</span>}
    </div>
  );
}
export function Navigator({
  data,
  range,
  revision,
  onNavigate,
}: {
  data: SessionData;
  range: TimeRange;
  revision: number;
  onNavigate: (start: number) => void;
}) {
  const full = { start: 0, end: Math.max(1, data.duration) };
  const navigate = (element: HTMLElement, clientX: number) => {
    const rect = element.getBoundingClientRect();
    onNavigate(
      ((clientX - rect.left - LEFT) / Math.max(1, rect.width - LEFT - RIGHT)) * data.duration -
        (range.end - range.start) / 2,
    );
  };
  return (
    <div
      className="navigator"
      onWheel={(event) => {
        onNavigate(
          range.start + ((event.deltaX || event.deltaY) / 500) * (range.end - range.start),
        );
      }}
    >
      <div
        className="nav-drag"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          navigate(event.currentTarget, event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            navigate(event.currentTarget, event.clientX);
        }}
      >
        <TimeChart data={data} range={full} kind="waveform" revision={revision} compact />
        <div
          className="nav-selection"
          style={{
            left: `calc(62px + (100% - 86px) * ${range.start / full.end})`,
            width: `calc((100% - 86px) * ${Math.min(1, (range.end - range.start) / full.end)})`,
          }}
        />
      </div>
      <label className="nav-slider">
        Browse history
        <input
          aria-label="Browse history"
          type="range"
          min={0}
          max={Math.max(0, data.duration - (range.end - range.start))}
          step={0.01}
          value={range.start}
          onChange={(event) => onNavigate(Number(event.target.value))}
        />
        <span>
          {formatTime(range.start)} — {formatTime(Math.min(data.duration, range.end))}
        </span>
      </label>
    </div>
  );
}
export async function saveImage(
  data: SessionData,
  range: TimeRange,
  view: 'spectrum' | 'spectrogram' | 'waveform',
  target: number | null,
  snapshot: HTMLCanvasElement | null,
  cutoff = data.duration,
  pitchLow?: number,
) {
  const lastPitch = data.history.latestPitch(range.start, Math.min(range.end, cutoff));
  const low =
    pitchLow ??
    followPitchLow(
      DEFAULT_PITCH_LOW,
      lastPitch?.hz ? 69 + 12 * Math.log2(lastPitch.hz / 440) : target,
    );
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 1240;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#161c18';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#e2edd9';
  ctx.font = '26px sans-serif';
  ctx.fillText(
    `Pitch Studio · ${view === 'spectrum' ? 'Spectrum snapshot' : view === 'spectrogram' ? 'Spectrogram' : 'Waveform overview'}`,
    62,
    45,
  );
  ctx.font = '15px sans-serif';
  ctx.fillStyle = '#a3afa1';
  ctx.fillText(
    `${data.name}  |  ${formatTime(range.start, true)} — ${formatTime(range.end, true)}  |  48 kHz  |  Pitch range ${noteName(low)} — ${noteName(low + PITCH_SPAN)}`,
    62,
    78,
  );
  ctx.save();
  ctx.translate(0, 100);
  drawTimePlot(ctx, 1600, PITCH_CHART_HEIGHT, data, range, 'pitch', target, null, cutoff, low);
  ctx.restore();
  ctx.save();
  ctx.translate(0, 710);
  if (view === 'spectrum' && snapshot) ctx.drawImage(snapshot, 0, 0, 1600, 430);
  else
    drawTimePlot(
      ctx,
      1600,
      430,
      data,
      range,
      view === 'spectrum' ? 'waveform' : view,
      target,
      null,
      cutoff,
    );
  ctx.restore();
  ctx.font = '15px sans-serif';
  ctx.fillStyle = '#a3afa1';
  if (view === 'spectrogram') {
    for (let i = 0; i < 256; i++) {
      ctx.fillStyle = `rgb(${colors[i].join(',')})`;
      ctx.fillRect(62 + i * 2, 1173, 2, 14);
    }
    ctx.fillStyle = '#a3afa1';
    ctx.fillText('−100 dB', 62, 1215);
    ctx.fillText('−15 dB', 510, 1215);
  }
  ctx.fillText(
    view === 'spectrum'
      ? 'X: Hz (log scale) · Y: dB · Spectrum shows the current snapshot'
      : 'X: session time (mm:ss) · Gaps indicate missing analysis',
    670,
    1198,
  );
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Unable to create the PNG');
  downloadBlob(blob, `${data.name}-${view}.png`);
}
