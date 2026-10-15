import { test, expect } from '@playwright/test';
import { installAudioSource } from './source';

test('pitch grid follows live notes, holds manual ranges, and preserves them in files', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await installAudioSource(page);
  await page.addInitScript(() => {
    const fill = CanvasRenderingContext2D.prototype.fillText;
    const rect = CanvasRenderingContext2D.prototype.fillRect;
    (window as any).pitchLabels = [];
    CanvasRenderingContext2D.prototype.fillRect = function (...args) {
      if (this.canvas.dataset.testid === 'time-pitch' && args[0] === 0 && args[1] === 0)
        (window as any).pitchLabels = [];
      rect.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.fillText = function (...args) {
      if (this.canvas.dataset.testid === 'time-pitch' && /^[A-G]♯?\d$/.test(args[0]))
        (window as any).pitchLabels.push(args[0]);
      fill.apply(this, args);
    };
  });
  await page.goto('/');
  const chart = page.getByTestId('time-pitch');
  const slider = page.getByRole('slider', { name: 'Pitch display range' });
  await expect(page.getByRole('group', { name: 'Pitch axis mode' })).toHaveCount(0);
  await expect(slider).toHaveValue('48');
  expect((await chart.boundingBox())!.height).toBe(560);
  expect(await page.evaluate(() => (window as any).pitchLabels)).toHaveLength(25);
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByTestId('pitch-note')).toHaveText('A3');
  await page.evaluate(() => (window as any).testAudio.setMode('glide'));
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(48);
  await slider.fill('36');
  // Even a continuing note, without a new onset, resumes tracking next frame.
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(48);
  await page.evaluate(() => (window as any).testAudio.setMode('silence'));
  await expect(page.getByTestId('pitch-note')).toHaveText('—');
  await slider.fill('36');
  await page.waitForTimeout(150);
  await expect(slider).toHaveValue('36');
  await page.evaluate(() => (window as any).testAudio.setMode('harmonic'));
  await page.evaluate(() => (window as any).testAudio.setFrequency(880));
  await expect(page.getByTestId('pitch-note')).toHaveText('A5');
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(60);
  await page.getByRole('button', { name: 'Freeze display' }).click();
  await slider.fill('36');
  await page.waitForTimeout(150);
  await expect(slider).toHaveValue('36');
  await page.getByRole('button', { name: 'Resume display' }).click();
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(60);
  await page.getByRole('button', { name: 'Stop microphone' }).click();
  await expect(page.getByRole('button', { name: 'Download WAV' })).toBeEnabled();
  const audio = page.getByLabel('Recording playback');
  await slider.fill('48');
  await audio.evaluate((e: HTMLAudioElement) => e.play());
  await page.waitForTimeout(200);
  await expect(slider).toHaveValue('48');
  await audio.evaluate((e: HTMLAudioElement) => {
    e.pause();
    e.currentTime = 0;
  });
  await chart.scrollIntoViewIfNeeded();
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + 160, box.y + 260);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 344, { steps: 8 });
  await page.mouse.up();
  await expect(slider).toHaveValue('52');
  expect(await audio.evaluate((e: HTMLAudioElement) => e.currentTime)).toBe(0);
  const scrollY = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, -80);
  await expect(slider).toHaveValue('54');
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
  await chart.focus();
  await page.keyboard.press('ArrowDown');
  await expect(slider).toHaveValue('53');
  await page.keyboard.press('PageDown');
  await expect(slider).toHaveValue('41');
  await chart.click({ position: { x: 160, y: 300 } });
  expect(await audio.evaluate((e: HTMLAudioElement) => e.currentTime)).toBeGreaterThan(0);
  await slider.fill('48');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save session', exact: true }).click();
  const file = await download;
  await file.saveAs(info.outputPath('pitch-range.pitchsession'));
  await slider.fill('70');
  await page
    .getByLabel('Import session file')
    .setInputFiles(info.outputPath('pitch-range.pitchsession'));
  await expect(slider).toHaveValue('48');
  await audio.evaluate((e: HTMLAudioElement) => e.play());
  await page.waitForTimeout(200);
  await expect(slider).toHaveValue('48');
  await audio.evaluate((e: HTMLAudioElement) => e.pause());
  expect(await page.evaluate(() => (window as any).pitchLabels)).toHaveLength(25);
  await page
    .locator('.tuner-panel')
    .screenshot({ path: info.outputPath('two-octaves-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .locator('.tuner-panel')
    .screenshot({ path: info.outputPath('two-octaves-mobile.png') });
  expect(errors).toEqual([]);
});
