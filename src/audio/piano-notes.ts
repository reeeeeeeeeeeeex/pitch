export const PIANO_FIRST = 21; // A0
export const PIANO_LAST = 108; // C8
export const PIANO_KEYS = Array.from(
  { length: PIANO_LAST - PIANO_FIRST + 1 },
  (_, index) => PIANO_FIRST + index,
);
export const isBlackKey = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);

// Salamander's browser sample set records every minor third. The nearest
// recording is at most one semitone away from each of the 88 piano keys.
export function pianoSample(midi: number) {
  if (!Number.isInteger(midi) || midi < PIANO_FIRST || midi > PIANO_LAST)
    throw new RangeError('Piano note must be A0–C8');
  const root = PIANO_FIRST + Math.round((midi - PIANO_FIRST) / 3) * 3;
  const name = ({ 0: 'C', 3: 'Ds', 6: 'Fs', 9: 'A' } as Record<number, string>)[root % 12];
  return {
    midi: root,
    file: `${name}${Math.floor(root / 12) - 1}.mp3`,
    rate: 2 ** ((midi - root) / 12),
  };
}
