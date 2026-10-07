import { memo } from 'react';
import { Headphones, RotateCcw } from 'lucide-react';
import { noteName } from '../audio/analysis';
import { PIANO_KEYS, PIANO_FIRST, isBlackKey } from '../audio/piano-notes';

const WHITES = PIANO_KEYS.filter((midi) => !isBlackKey(midi));

export const Piano = memo(function Piano({
  target,
  detected,
  loading,
  onPlay,
  onClear,
}: {
  target: number | null;
  detected: number | null;
  loading: boolean;
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
          {black
            ? noteName(midi).replace(/\d/, '')
            : midi % 12 === 0 || midi === PIANO_FIRST
              ? noteName(midi)
              : ''}
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
        <div className="piano-keyboard" role="group" aria-label="A0 到 C8，88 键参考钢琴">
          <div className="white-keys">{WHITES.map((midi) => key(midi, false))}</div>
          {PIANO_KEYS.filter(isBlackKey).map((midi) => key(midi, true))}
        </div>
      </div>
      <div className="piano-footer">
        <span>
          <Headphones size={14} />
          建议佩戴耳机，避免参考音进入麦克风
        </span>
        <span>
          88 键 · A0 — C8 <b>·</b> A4 = 440 Hz
        </span>
      </div>
      <div className="piano-sound">
        <span>
          音色：
          <a
            href={`${import.meta.env.BASE_URL}piano/salamander/ATTRIBUTION.txt`}
            target="_blank"
            rel="noreferrer"
          >
            Salamander Grand Piano · Alexander Holm · CC BY 3.0
          </a>
        </span>
        <span role="status">{loading ? '正在加载钢琴音色…' : '真实钢琴采样'}</span>
      </div>
    </section>
  );
});
