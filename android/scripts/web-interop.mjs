import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const compiled = resolve(root, '.local/android-web-interop');
await mkdir(compiled, { recursive: true });
for (const name of ['analysis', 'history', 'archive', 'piano-notes', 'pitch-viewport']) {
  const source = await readFile(resolve(root, `src/audio/${name}.ts`), 'utf8');
  const javascript = stripTypeScriptTypes(source, { mode: 'strip' })
    .replace(/from '(\.\/[\w-]+)'/g, "from '$1.js'");
  await writeFile(resolve(compiled, `${name}.js`), javascript);
}
const module = name => import(pathToFileURL(resolve(compiled, `${name}.js`)).href);
try {
  const { encodeSession, decodeSession, DEFAULT_DISPLAY } = await module('archive');
  const { HistoryStore, EnvelopeStore } = await module('history');
  const { PitchAnalysis, measureLevel } = await module('analysis');
  const output = resolve(root, 'android/core/src/test/resources/web.pitchsession');
  const history = new HistoryStore(); const envelopes = new EnvelopeStore();
  const samples = new Int16Array(48000);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.round(Math.sin(2 * Math.PI * 220 * i / 48000) * 8000);
  const wav = new Uint8Array(44 + samples.byteLength); const header = new DataView(wav.buffer);
  wav.set(new TextEncoder().encode('RIFF')); header.setUint32(4, wav.length - 8, true);
  wav.set(new TextEncoder().encode('WAVEfmt '), 8); header.setUint32(16, 16, true);
  header.setUint16(20, 1, true); header.setUint16(22, 1, true); header.setUint32(24, 48000, true);
  header.setUint32(28, 96000, true); header.setUint16(32, 2, true); header.setUint16(34, 16, true);
  wav.set(new TextEncoder().encode('data'), 36); header.setUint32(40, samples.byteLength, true); wav.set(new Uint8Array(samples.buffer), 44);
  const waveform = Float32Array.from(samples.slice(0, 4096), x => x / 32768);
  const level = measureLevel(waveform); const pitch = new PitchAnalysis().detect(waveform, 48000, level.rmsDb);
  let latest;
  for (let i = 1; i <= 30; i++) { latest = { time: i / 30, sampleRate: 48000, waveform, spectrum: new Float32Array(4096).fill(-70), pitch, ...level }; history.append(latest); }
  for (let i = 0; i < 100; i++) envelopes.append({ time: i / 100, min: -.25, max: .25 });
  const blob = encodeSession({ name: 'Web A3 fixture', createdAt: '2026-10-07T00:00:00.000Z', recorded: true, duration: 1, sampleRate: 48000, wav: new Blob([wav]), history, envelopes, latest, settings: null }, { ...DEFAULT_DISPLAY, target: null, pitchLow: 36, pitchFollowing: false });
  await mkdir(resolve(output, '..'), { recursive: true }); await writeFile(output, Buffer.from(await blob.arrayBuffer()));
  if (process.argv[2]) {
    const decoded = await decodeSession(new Blob([await readFile(resolve(process.argv[2]))]));
    if (decoded.data.duration !== 1 || decoded.data.history.length !== 30 || decoded.display.target !== null || decoded.display.pitchLow !== 36) throw new Error('Android round-trip metadata mismatch');
    const actualWav = Buffer.from(await decoded.data.wav.arrayBuffer());
    if (!actualWav.equals(Buffer.from(wav))) throw new Error('Android round-trip PCM mismatch');
    console.log('PASS: Web → Android → Web: duration, 30 history frames, null target, manual pitch range and PCM are identical.');
  } else console.log('Generated fixture through the actual web session encoder:', output);
} catch (error) { console.error(error); process.exitCode = 1; }
