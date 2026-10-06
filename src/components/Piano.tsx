import { memo } from 'react';
import { Headphones, RotateCcw } from 'lucide-react';
import { noteName } from '../audio/analysis';

const KEYS = Array.from({ length: 61 }, (_, index) => index + 36);
const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);
const WHITES = KEYS.filter((midi) => !isBlack(midi));

export const Piano = memo(function Piano({
  target,
  detected,
  onPlay,
  onClear,
}: {
  target: number | null;
  detected: number | null;
  onPlay: (midi: number) => void;
  onClear: () => void;
}) {
  const key = (midi: number, black: boolean) => {
    const before = WHITES.filter((white) => white < midi).length;
    return (
      <button
        key={midi}
        type="button"
        aria-label={`试听 ${noteName(midi)}`}
        aria-pressed={target === midi}
        className={`piano-key ${black ? 'black' : 'white'} ${target === midi ? 'target' : ''} ${detected === midi ? 'detected' : ''}`}
        style={
          black
            ? {
                left: `${((before - 0.32) / WHITES.length) * 100}%`,
                width: `${(0.64 / WHITES.length) * 100}%`,
              }
            : undefined
        }
        onClick={() => onPlay(midi)}
      >
        <span>
          {black ? noteName(midi).replace(/\d/, '') : midi % 12 === 0 ? noteName(midi) : ''}
        </span>
      </button>
    );
  };
  return (
    <section className="panel piano-panel" aria-labelledby="piano-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">REFERENCE</span>
          <h2 id="piano-title">找一个音，跟着唱</h2>
        </div>
        <div className="piano-legend">
          <span>
            <i className="legend-dot target-dot" />
            目标音
          </span>
          <span>
            <i className="legend-dot detected-dot" />
            当前音
          </span>
          {target !== null && (
            <button className="text-button" onClick={onClear}>
              <RotateCcw size={13} />
              清除目标
            </button>
          )}
        </div>
      </div>
      <div className="piano-scroll">
        <div className="piano-keyboard" role="group" aria-label="C2 到 C7 参考音钢琴键盘">
          <div className="white-keys">{WHITES.map((midi) => key(midi, false))}</div>
          {KEYS.filter(isBlack).map((midi) => key(midi, true))}
        </div>
      </div>
      <div className="piano-footer">
        <span>
          <Headphones size={14} />
          建议佩戴耳机，避免参考音进入麦克风
        </span>
        <span>
          C2 — C7 <b>·</b> A4 = 440 Hz <b>·</b> 合成参考音
        </span>
      </div>
    </section>
  );
});
