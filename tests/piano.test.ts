import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PIANO_KEYS, isBlackKey, pianoSample } from '../src/audio/piano-notes';

describe('88-key sampled piano', () => {
  it('covers A0–C8 with 52 white and 36 black keys', () => {
    expect(PIANO_KEYS).toHaveLength(88);
    expect(PIANO_KEYS[0]).toBe(21);
    expect(PIANO_KEYS.at(-1)).toBe(108);
    expect(PIANO_KEYS.filter(isBlackKey)).toHaveLength(36);
    expect(PIANO_KEYS.filter((midi) => !isBlackKey(midi))).toHaveLength(52);
  });
  it('maps every key to a bundled, unchanged recording within one semitone', () => {
    const manifest = JSON.parse(
      readFileSync('public/piano/salamander/source.json', 'utf8').replace(/^\uFEFF/, ''),
    );
    const files = new Set<string>();
    for (const midi of PIANO_KEYS) {
      const sample = pianoSample(midi);
      expect(Math.abs(sample.midi - midi)).toBeLessThanOrEqual(1);
      expect(sample.midi + 12 * Math.log2(sample.rate)).toBeCloseTo(midi, 10);
      files.add(sample.file);
    }
    expect(files.size).toBe(30);
    for (const file of files) {
      const entry = manifest.files.find((item: { name: string }) => item.name === file);
      expect(entry).toBeDefined();
      const bytes = readFileSync(`public/piano/salamander/${file}`);
      expect(bytes.byteLength).toBe(entry.size);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
    }
  });
  it.each([20, 109, 21.5, NaN])('rejects invalid note %s', (midi) => {
    expect(() => pianoSample(midi)).toThrow(RangeError);
  });
});
