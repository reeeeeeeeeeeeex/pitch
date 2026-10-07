// Validate the Android 30-minute result through the actual web decoder and Pitchy detector.
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
const root = resolve(import.meta.dirname, '../..');
const compiled = resolve(root, '.local/android-web-interop');
await mkdir(compiled, { recursive: true });
for (const name of ['analysis', 'history', 'archive', 'piano-notes', 'pitch-viewport']) {
  const source = await readFile(resolve(root, `src/audio/${name}.ts`), 'utf8');
  await writeFile(resolve(compiled, `${name}.js`), stripTypeScriptTypes(source, { mode: 'strip' }).replace(/from '(\.\/[\w-]+)'/g, "from '$1.js'"));
}
assert(process.argv[2], 'Usage: node android/scripts/check-soak.mjs <complete.pitchsession>');
const { decodeSession } = await import(pathToFileURL(resolve(compiled, 'archive.js')));
const { PitchAnalysis, measureLevel } = await import(pathToFileURL(resolve(compiled, 'analysis.js')));
const { data } = await decodeSession(new Blob([await readFile(resolve(process.argv[2]))]));
assert.equal(data.duration, 1800);
assert.equal(data.sampleRate, 48000);
assert.equal(data.recorded, true);
assert.equal(data.wav.size, 172800044);
assert(data.history.get(0).time < 1);
assert(data.history.get(data.history.length - 1).time > 1799);
const hash = createHash('sha256');
for await (const bytes of Readable.fromWeb(data.wav.stream())) hash.update(bytes);
const detector = new PitchAnalysis();
const checks = [];
for (const [time, expected] of [[5, 220], [45, 110], [75, 220], [105, 440], [135, 880], [165, 110], [190, null], [225, 440], [490, null], [1785, 440]]) {
  const start = 44 + time * 48000 * 2;
  const pcm = new DataView(await data.wav.slice(start, start + 4096 * 2).arrayBuffer());
  const wave = Float32Array.from({ length: 4096 }, (_, i) => pcm.getInt16(i * 2, true) / 32768);
  const level = measureLevel(wave);
  const pitch = detector.detect(wave, 48000, level.rmsDb);
  const historical = data.history.near(time);
  assert(historical, `No history near ${time}`);
  if (expected === null) {
    assert.equal(pitch, null); assert.equal(historical.hz, 0);
    assert(wave.every(x => x === 0));
  } else {
    assert(pitch);
    assert(Math.abs(1200 * Math.log2(pitch.hz / expected)) < 5, `WAV pitch mismatch at ${time}`);
    assert(Math.abs(1200 * Math.log2(historical.hz / expected)) < 5, `History mismatch at ${time}`);
  }
  checks.push({ time, expected, wavHz: pitch?.hz ?? null, historyHz: historical.hz });
}
console.log(JSON.stringify({ result: 'PASS', duration: data.duration, samples: 86400000,
  historyFrames: data.history.length, lastFrameTime: data.history.get(data.history.length - 1).time,
  wavSha256: hash.digest('hex'), checks }, null, 2));
