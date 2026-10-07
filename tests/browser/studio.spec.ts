import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Browser-only test source. Production has no demo data or microphone bypass.
import { installAudioSource } from './source';

test('idle workspace is honest, responsive, and keyboard accessible', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('声见');
  await expect(page.getByTestId('pitch-note')).toHaveText('—');
  await expect(page.getByRole('button', { name: '冻结画面' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /^试听 / })).toHaveCount(88);
  await expect(page.locator('.piano-key.white')).toHaveCount(52);
  await expect(page.locator('.piano-key.black')).toHaveCount(36);
  await page.screenshot({ path: testInfo.outputPath('desktop-idle.png'), fullPage: true });
  await page.getByRole('tab', { name: '频谱图' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '声谱图' })).toBeFocused();
  await expect(page.getByRole('tab', { name: '声谱图' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: '使用指南' }).click();
  await expect(page.getByText('三个简单的步骤')).toBeVisible();
  await page.getByRole('button', { name: '关闭指南' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('mobile-idle.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('real Web Audio processes harmonics, all views, freeze, piano, and stop', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installAudioSource(page);
  await page.goto('/');
  await page.getByRole('button', { name: '开启麦克风' }).click();
  await expect(page.getByTestId('pitch-hz')).toHaveText(/^220\./);
  await expect(page.getByTestId('pitch-note')).toHaveText('A3');
  await expect(page.locator('.peak-chip').first()).toContainText('440');
  await expect(page.locator('.peak-chip')).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath('spectrum-live.png'), fullPage: true });
  await page.getByRole('button', { name: '试听 A3', exact: true }).click();
  await expect(page.getByRole('button', { name: '试听 A3', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('cents')).toContainText(/[-+−]0\.\d/);
  await page.getByRole('button', { name: '试听 C4', exact: true }).click();
  await expect(page.getByTestId('cents')).toContainText('−300.');
  await page.getByRole('button', { name: '清除目标' }).click();
  await page.getByRole('tab', { name: '声谱图' }).click();
  await page.evaluate(() => (window as any).testAudio.setMode('glide'));
  await page.waitForTimeout(3300);
  await page.getByRole('button', { name: '冻结画面' }).click();
  const frozenCanvas = await page
    .getByTestId('time-spectrogram')
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.evaluate(() => (window as any).testAudio.setMode('silence'));
  await expect(page.getByTestId('pitch-note')).toHaveText('—');
  expect(
    await page
      .getByTestId('time-spectrogram')
      .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()),
  ).toBe(frozenCanvas);
  await page.screenshot({ path: testInfo.outputPath('spectrogram-frozen.png'), fullPage: true });
  await page.getByRole('button', { name: '恢复实时' }).click();
  await page.getByRole('tab', { name: '波形图' }).click();
  await page.getByLabel('波形时间窗口').selectOption('50');
  await page.getByLabel('波形显示放大').selectOption('4');
  await page.evaluate(() => (window as any).testAudio.setMode('harmonic'));
  await expect(page.getByTestId('pitch-note')).toHaveText('A3');
  await page.screenshot({ path: testInfo.outputPath('waveform-live.png'), fullPage: true });
  expect(await page.evaluate(() => (window as any).testAudio.calls)).toBe(1);
  const constraints = await page.evaluate(() => (window as any).testAudio.constraints);
  expect(constraints.audio.echoCancellation).toBe(false);
  expect(constraints.audio.noiseSuppression).toBe(false);
  expect(constraints.audio.autoGainControl).toBe(false);
  await page.getByRole('button', { name: '停止麦克风' }).click();
  await expect(page.getByTestId('pitch-note')).toHaveText('—');
  await expect.poll(() => page.evaluate(() => (window as any).testAudio.closed)).toBe(1);
  expect(
    await page.evaluate(() =>
      (window as any).testAudio.streams.every((stream: MediaStream) =>
        stream.getTracks().every((track) => track.readyState === 'ended'),
      ),
    ),
  ).toBe(true);
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '开启麦克风' }).click();
    await page.getByRole('button', { name: '放弃并继续' }).click();
    await expect(page.getByTestId('pitch-note')).toHaveText('A3');
    await page.getByRole('button', { name: '停止麦克风' }).click();
  }
  await expect.poll(() => page.evaluate(() => (window as any).testAudio.stopped)).toBe(4);
  expect(errors).toEqual([]);
});

for (const [mode, message] of [
  ['denied', '麦克风权限未开启'],
  ['missing', '没有找到麦克风'],
  ['busy', '无法读取麦克风'],
]) {
  test(`handles ${mode} and supports retry`, async ({ page }) => {
    await installAudioSource(page, mode);
    await page.goto('/');
    await page.getByRole('button', { name: '开启麦克风' }).click();
    await expect(page.getByRole('alert')).toContainText(message);
    await page.evaluate(() => {
      (window as any).testAudio.mode = 'harmonic';
    });
    await page.getByRole('button', { name: '重试' }).click();
    await expect(page.getByTestId('pitch-note')).toHaveText('A3');
  });
}

test('cancelling a pending permission request stops the late stream', async ({ page }) => {
  await installAudioSource(page, 'pending');
  await page.goto('/');
  await page.getByRole('button', { name: '开启麦克风' }).click();
  await expect.poll(() => page.evaluate(() => !!(window as any).testAudio.release)).toBe(true);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.evaluate(() => (window as any).testAudio.release());
  await expect.poll(() => page.evaluate(() => (window as any).testAudio.stopped)).toBe(1);
  await expect(page.getByRole('button', { name: '开启麦克风' })).toBeVisible();
  await expect(page.getByTestId('pitch-note')).toHaveText('—');
});

test('device disconnection releases the stream and reports the cause', async ({ page }) => {
  await installAudioSource(page);
  await page.goto('/');
  await page.getByRole('button', { name: '开启麦克风' }).click();
  await expect(page.getByTestId('pitch-note')).toHaveText('A3');
  await page.evaluate(() =>
    (window as any).testAudio.streams[0].getAudioTracks()[0].dispatchEvent(new Event('ended')),
  );
  await expect(page.getByRole('alert')).toContainText('麦克风已断开');
  await expect.poll(() => page.evaluate(() => (window as any).testAudio.stopped)).toBe(1);
});

test('suspended audio clears stale pitch and resumes with a time gap', async ({ page }) => {
  await installAudioSource(page);
  await page.goto('/');
  await page.getByRole('button', { name: '开启麦克风' }).click();
  await expect(page.getByTestId('pitch-note')).toHaveText('A3');
  await page.evaluate(() => (window as any).testAudio.allContexts[0].suspend());
  await expect(page.getByTestId('pitch-note')).toHaveText('—');
  const before = await page.evaluate(() => (window as any).testAudio.samples);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as any).testAudio.samples)).toBe(before);
  await page.evaluate(() => (window as any).testAudio.allContexts[0].resume());
  await expect(page.getByTestId('pitch-note')).toHaveText('A3');
  await page.getByRole('button', { name: '停止麦克风' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).testAudio.allContexts.every((ctx: AudioContext) => ctx.state === 'closed'),
      ),
    )
    .toBe(true);
});

test('ten minute continuous analysis stays responsive and releases all contexts', async ({
  page,
  context,
}, testInfo) => {
  test.skip(process.env.RUN_SOAK !== '1', 'Run explicitly with npm run test:soak');
  test.setTimeout(660000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installAudioSource(page);
  await page.goto('/');
  await page.getByRole('button', { name: '开启麦克风' }).click();
  await expect(page.getByTestId('pitch-note')).toHaveText('A3');
  const client = await context.newCDPSession(page);
  const observations: Record<string, number>[] = [];
  const started = Date.now();
  let previousSamples = 0;
  let previousTime = started;
  for (let interval = 0; interval < 20; interval++) {
    const mode = ['频谱图', '声谱图', '波形图'][Math.floor(interval / 2) % 3];
    await page.getByRole('tab', { name: mode }).click();
    // Each wait is bounded; the owning chat can continue to report progress.
    await page.waitForTimeout(30000);
    await expect(page.getByTestId('pitch-note')).toHaveText('A3');
    const state = await page.evaluate(() => ({
      samples: (window as any).testAudio.samples,
      calls: (window as any).testAudio.calls,
    }));
    const now = Date.now();
    await client.send('HeapProfiler.collectGarbage');
    const memory = await client.send('Runtime.getHeapUsage');
    const observation = {
      elapsedSeconds: (now - started) / 1000,
      samplesPerSecond: (state.samples - previousSamples) / ((now - previousTime) / 1000),
      usedMB: memory.usedSize / 1024 / 1024,
      buffersMB: (memory.backingStorageSize ?? 0) / 1024 / 1024,
    };
    observations.push(observation);
    previousSamples = state.samples;
    previousTime = now;
    console.log(
      `[${testInfo.project.name}] soak ${Math.round(observation.elapsedSeconds)}s, ${observation.samplesPerSecond.toFixed(1)} samples/s, heap ${observation.usedMB.toFixed(1)} MB, buffers ${observation.buffersMB.toFixed(1)} MB`,
    );
    expect(state.calls).toBe(1);
    expect(observation.samplesPerSecond).toBeGreaterThan(24);
  }
  expect(Date.now() - started).toBeGreaterThanOrEqual(600000);
  expect(observations.at(-1)!.usedMB - observations[0].usedMB).toBeLessThan(15);
  expect(observations.at(-1)!.buffersMB - observations[0].buffersMB).toBeLessThan(15);
  await page.getByRole('button', { name: '停止麦克风' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).testAudio.allContexts.every((ctx: AudioContext) => ctx.state === 'closed'),
      ),
    )
    .toBe(true);
  const samplesAtStop = await page.evaluate(() => (window as any).testAudio.samples);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => (window as any).testAudio.samples)).toBe(samplesAtStop);
  expect(errors).toEqual([]);
  const metricsPath = testInfo.outputPath('soak-metrics.json');
  await writeFile(metricsPath, JSON.stringify(observations, null, 2));
  await testInfo.attach('soak-metrics.json', {
    path: metricsPath,
    contentType: 'application/json',
  });
});
