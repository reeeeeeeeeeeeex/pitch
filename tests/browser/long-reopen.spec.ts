import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
async function sha256(path: string) {
  const hash = createHash('sha256');
  for await (const part of createReadStream(path)) hash.update(part);
  return hash.digest('hex');
}
test('saved long session opens without a microphone in the final build', async ({ page }, info) => {
  test.skip(
    process.env.TEST_LONG_ARCHIVE !== '1',
    'Requires the completed 30-minute recording artifact',
  );
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.assign(window, { micCalls: 0 });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: () => {
        (window as any).micCalls++;
        throw new Error('Imported sessions must not request a microphone');
      },
    });
  });
  await page.goto('/');
  await page
    .getByLabel('Import session file')
    .setInputFiles('.local/recording-soak/30min.pitchsession');
  await expect(page.getByText('Session opened. You can now review and export it.')).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByTestId('session-duration')).toHaveText('30:00.00');
  await page.getByLabel('Timeline range').selectOption('10');
  await page.getByLabel('Browse history').fill('600');
  await page.getByRole('tab', { name: 'Spectrogram' }).click();
  await page.getByTestId('time-spectrogram').click({ position: { x: 450, y: 110 } });
  const audio = page.getByLabel('Recording playback');
  const seek = await audio.evaluate((element: HTMLAudioElement) => element.currentTime);
  expect(seek).toBeGreaterThan(600);
  expect(seek).toBeLessThan(610);
  await audio.evaluate(async (element: HTMLAudioElement) => {
    element.currentTime = 1790;
    await element.play();
  });
  await page.waitForTimeout(500);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(
    1790,
  );
  await audio.evaluate((element: HTMLAudioElement) => element.pause());
  await page.getByLabel('Timeline range').selectOption('0');
  await page.getByLabel('Image range').selectOption('whole');
  const pngPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save PNG' }).click();
  const png = info.outputPath('final-long-overview.png');
  await (await pngPromise).saveAs(png);
  const pngBytes = await readFile(png);
  expect(pngBytes.readUInt32BE(16)).toBe(1600);
  const wavPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download WAV' }).click();
  const wav = info.outputPath('reopened.wav');
  await (await wavPromise).saveAs(wav);
  const hash = await sha256(wav);
  expect(hash).toBe(await sha256('.local/recording-soak/30min.wav'));
  expect(await page.evaluate(() => (window as any).micCalls)).toBe(0);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('final-long-reopened.png'), fullPage: true });
  await writeFile(
    info.outputPath('verification.json'),
    JSON.stringify(
      { browser: info.project.name, duration: 1800, seek, wavSha256: hash, micCalls: 0, errors },
      null,
      2,
    ),
  );
});
