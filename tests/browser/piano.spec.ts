import { expect, test } from '@playwright/test';
import { PIANO_KEYS, pianoSample } from '../../src/audio/piano-notes';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const starts: { rate: number; duration: number; audible: boolean }[] = [];
    (window as any).pianoStarts = starts;
    const create = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = create.call(this);
      const start = source.start.bind(source);
      source.start = (...args: Parameters<typeof source.start>) => {
        starts.push({
          rate: source.playbackRate.value,
          duration: source.buffer?.duration ?? 0,
          audible:
            source.buffer?.getChannelData(0).some((sample) => Math.abs(sample) > 0.01) ?? false,
        });
        start(...args);
      };
      return source;
    };
  });
});

test('88 keys play recorded samples at both ends and transpose neighboring notes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('.mp3')) requests.push(new URL(request.url()).pathname);
  });
  await page.goto('/');
  expect(requests).toHaveLength(0);
  for (const [i, note] of ['A0', 'A♯0', 'C4', 'C8'].entries()) {
    await page.getByRole('button', { name: `Play ${note}`, exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).pianoStarts.length)).toBe(i + 1);
    await expect(page.getByRole('button', { name: `Play ${note}`, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
  expect(requests).toEqual([
    '/piano/salamander/A0.mp3',
    '/piano/salamander/C4.mp3',
    '/piano/salamander/C8.mp3',
  ]);
  const starts = await page.evaluate(() => (window as any).pianoStarts);
  expect(starts[1].rate).toBeCloseTo(2 ** (1 / 12));
  expect(starts.every((s: any) => s.duration > 0.2 && s.audible)).toBe(true);
  await expect(page.locator('.piano-sound [role=status]')).toHaveText('Sampled grand piano');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('stale downloads do not play an old key, and failed samples can be retried', async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/piano/salamander/A0.mp3', async (route) => {
    await gate;
    await route.abort();
  });
  await page.route('**/piano/salamander/C4.mp3', (route) => route.fulfill({ status: 503 }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Play A0', exact: true }).click();
  await expect(page.locator('.piano-sound [role=status]')).toHaveText('Loading piano samples…');
  await page.getByRole('button', { name: 'Play C8', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).pianoStarts.length)).toBe(1);
  release();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Play C4', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Unable to load or play the piano sound');
  await page.unroute('**/piano/salamander/C4.mp3');
  await page.getByRole('button', { name: 'Play C4', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).pianoStarts.length)).toBe(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('every bundled MP3 decodes to non-silent PCM in the browser', async ({ page }) => {
  await page.goto('/');
  const files = [...new Set(PIANO_KEYS.map((midi) => pianoSample(midi).file))];
  const decoded = await page.evaluate(async (names) => {
    const context = new OfflineAudioContext(1, 1, 44100);
    const results = [];
    for (const name of names) {
      const response = await fetch(`/piano/salamander/${name}`);
      if (!response.ok) throw new Error(`${name}: ${response.status}`);
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      const samples = buffer.getChannelData(0);
      results.push({
        name,
        duration: buffer.duration,
        audible: samples.some((value) => Math.abs(value) > 0.01),
      });
    }
    return results;
  }, files);
  expect(decoded).toHaveLength(30);
  for (const sample of decoded) {
    expect(sample.duration, sample.name).toBeGreaterThan(0.2);
    expect(sample.audible, sample.name).toBe(true);
  }
});
