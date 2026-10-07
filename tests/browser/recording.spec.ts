import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { installAudioSource } from './source';
import { PitchAnalysis, measureLevel } from '../../src/audio/analysis';
async function download(page: Page, button: string, path: string) {
  const promise = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const result = await promise;
  await result.saveAs(path);
  return path;
}
function parse(buffer: Buffer) {
  const length = buffer.readUInt32LE(8);
  const manifest = JSON.parse(buffer.subarray(12, 12 + length).toString());
  let offset = 12 + length;
  const blocks = manifest.lengths.map((size: number) => {
    const b = buffer.subarray(offset, offset + size);
    offset += size;
    return b;
  });
  return { manifest, blocks };
}
test('recording, history navigation, PNG, archive roundtrip and replacement guards', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await installAudioSource(page);
  await page.goto('/');
  await page.getByRole('button', { name: '开始录音' }).click();
  await expect(page.getByTestId('pitch-note')).toHaveText('A3');
  await page.waitForTimeout(1300);
  const silenceAt = await page.evaluate(() => {
    (window as any).testAudio.setMode('silence');
    const text = document.querySelector('[data-testid="session-duration"]')!.textContent!;
    const [minutes, seconds] = text.split(':').map(Number);
    return minutes * 60 + seconds;
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => (window as any).testAudio.setMode('glide'));
  await page.getByRole('tab', { name: '声谱图' }).click();
  await page.getByRole('button', { name: '冻结画面' }).click();
  await page.waitForTimeout(1100);
  await page.getByRole('button', { name: '恢复实时' }).click();
  await page.getByLabel('时间轴范围').selectOption('10');
  await expect
    .poll(
      async () => Number((await page.getByTestId('session-duration').innerText()).split(':')[1]),
      { timeout: 15000 },
    )
    .toBeGreaterThan(11);
  await page.getByLabel('定位历史').fill('0');
  await expect(page.getByText('正在回看 · 采集不受影响', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '停止麦克风' }).click();
  await expect(page.getByRole('button', { name: '下载 WAV' })).toBeEnabled();
  const wavPath = await download(page, '下载 WAV', info.outputPath('short.wav'));
  const wav = await readFile(wavPath);
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
  expect(wav.readUInt32LE(24)).toBe(48000);
  expect(wav.readUInt32LE(40)).toBe(wav.length - 44);
  const duration = (wav.length - 44) / 96000;
  expect(duration).toBeGreaterThan(11);
  const rms = (start: number) => {
    let sum = 0;
    for (let i = Math.floor(start * 48000); i < Math.floor((start + 0.1) * 48000); i++) {
      const v = wav.readInt16LE(44 + i * 2) / 32768;
      sum += v * v;
    }
    return Math.sqrt(sum / 4800);
  };
  expect(rms(0.8)).toBeGreaterThan(0.1);
  expect(rms(silenceAt + 0.4)).toBeLessThan(0.02);
  const audio = page.getByLabel('录音回放');
  await audio.evaluate((element: HTMLAudioElement) => {
    element.currentTime = 1;
  });
  await expect.poll(() => audio.evaluate((e: HTMLAudioElement) => e.currentTime)).toBeCloseTo(1, 1);
  await page.getByTestId('time-spectrogram').click({ position: { x: 400, y: 100 } });
  expect(await audio.evaluate((e: HTMLAudioElement) => e.currentTime)).toBeGreaterThan(1);
  await audio.evaluate((e: HTMLAudioElement) => e.play());
  await page.waitForTimeout(500);
  await audio.evaluate((e: HTMLAudioElement) => e.pause());
  const visiblePng = await download(page, '保存 PNG', info.outputPath('visible.png'));
  await page.getByLabel('图像范围').selectOption('whole');
  const png = await download(page, '保存 PNG', info.outputPath('whole.png'));
  const pngBytes = await readFile(png);
  expect(pngBytes.readUInt32BE(16)).toBe(1600);
  expect(pngBytes.readUInt32BE(20)).toBe(930);
  expect(pngBytes.equals(await readFile(visiblePng))).toBe(false);
  await page.getByRole('button', { name: '开始录音' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(audio).toBeVisible();
  const archivePath = await download(page, '保存完整会话', info.outputPath('short.pitchsession'));
  const archive = parse(await readFile(archivePath));
  expect(archive.manifest.duration).toBe(duration);
  expect(archive.blocks[2].equals(wav)).toBe(true);
  expect(archive.blocks[0].readDoubleLE(0)).toBeLessThan(2);
  expect(archive.blocks[0].length / 536).toBeGreaterThan(200);
  const detector = new PitchAnalysis();
  let checked = 0;
  for (let offset = 0; offset < archive.blocks[0].length; offset += 536 * 20) {
    const time = archive.blocks[0].readDoubleLE(offset),
      hz = archive.blocks[0].readFloatLE(offset + 8);
    if (!hz || time < 0.2 || time >= duration) continue;
    const lastSample = Math.floor(time * 48000),
      waveform = new Float32Array(4096);
    for (let i = 0; i < 4096; i++)
      waveform[i] = wav.readInt16LE(44 + (lastSample - 4096 + i) * 2) / 32768;
    const detected = detector.detect(waveform, 48000, measureLevel(waveform).rmsDb);
    if (!detected) continue;
    expect(Math.abs(1200 * Math.log2(detected.hz / hz))).toBeLessThan(8);
    checked++;
  }
  expect(checked).toBeGreaterThan(5);
  const bad = Buffer.from(await readFile(archivePath));
  bad[0] = 0;
  await page
    .getByLabel('导入会话文件')
    .setInputFiles({ name: 'bad.pitchsession', mimeType: 'application/octet-stream', buffer: bad });
  await expect(page.getByRole('alert')).toContainText('不是支持');
  await expect(audio).toBeVisible();
  await page.getByLabel('导入会话文件').setInputFiles(archivePath);
  await expect(page.getByText('会话已打开，可回看与导出。')).toBeVisible();
  expect(await page.evaluate(() => (window as any).testAudio.calls)).toBe(1);
  const roundtrip = await download(page, '保存完整会话', info.outputPath('roundtrip.pitchsession'));
  const decoded = parse(await readFile(roundtrip));
  expect(decoded.manifest.duration).toBe(duration);
  for (let i = 0; i < 4; i++) expect(decoded.blocks[i].equals(archive.blocks[i])).toBe(true);
  await page.getByRole('tab', { name: '波形图' }).click();
  await page.screenshot({ path: info.outputPath('recording-reopened.png'), fullPage: true });
  expect(errors).toEqual([]);
});
test('disconnect flushes the partial recording and analysis-only files reopen', async ({
  page,
}, info) => {
  await installAudioSource(page);
  await page.goto('/');
  await page.getByRole('button', { name: '开始录音' }).click();
  await expect(page.getByTestId('pitch-note')).toHaveText('A3');
  await page.waitForTimeout(1400);
  await page.evaluate(() =>
    (window as any).testAudio.streams[0].getAudioTracks()[0].dispatchEvent(new Event('ended')),
  );
  await expect(page.getByRole('button', { name: '下载 WAV' })).toBeEnabled();
  const wav = await readFile(await download(page, '下载 WAV', info.outputPath('disconnected.wav')));
  expect((wav.length - 44) / 96000).toBeGreaterThan(1.4);
  await page.getByRole('button', { name: '开启麦克风' }).click();
  await page.getByRole('button', { name: '放弃并继续' }).click();
  await expect(page.getByTestId('pitch-note')).toHaveText('A3');
  await page.getByRole('button', { name: '停止麦克风' }).click();
  await expect(page.getByRole('button', { name: '保存完整会话' })).toBeEnabled();
  const archive = await download(page, '保存完整会话', info.outputPath('analysis.pitchsession'));
  await page.getByLabel('导入会话文件').setInputFiles(archive);
  await expect(page.getByText('会话已打开，可回看与导出。')).toBeVisible();
  await expect(page.getByRole('button', { name: '下载 WAV' })).toBeDisabled();
});
test('thirty minute continuous recording reaches the sample limit and reopens', async ({
  page,
  context,
}, info) => {
  test.skip(
    process.env.RUN_RECORDING_SOAK !== '1',
    'Explicit 30-minute wall-clock recording acceptance',
  );
  test.setTimeout(1950000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await installAudioSource(page);
  await page.goto('/');
  await page.getByRole('button', { name: '开始录音' }).click();
  await expect(page.getByTestId('pitch-note')).toHaveText('A3');
  const started = Date.now();
  const client = await context.newCDPSession(page);
  const observations: object[] = [];
  await mkdir('.local/recording-soak', { recursive: true });
  let previousSamples = 0,
    previousTime = started;
  while (
    Date.now() - started < 1800000 ||
    (await page.getByRole('button', { name: '停止麦克风' }).count())
  ) {
    await page.waitForTimeout(30000);
    const now = Date.now();
    const state = await page.evaluate(() => ({
      samples: (window as any).testAudio.samples,
      calls: (window as any).testAudio.calls,
    }));
    await client.send('HeapProfiler.collectGarbage');
    const heap = await client.send('Runtime.getHeapUsage');
    const o = {
      elapsedSeconds: (now - started) / 1000,
      samplesPerSecond: (state.samples - previousSamples) / ((now - previousTime) / 1000),
      usedMB: heap.usedSize / 1048576,
      buffersMB: (heap.backingStorageSize ?? 0) / 1048576,
    };
    observations.push(o);
    previousSamples = state.samples;
    previousTime = now;
    await writeFile(
      '.local/recording-soak/progress.json',
      JSON.stringify({ status: 'running', observations, errors }, null, 2),
    );
    console.log(
      `recording ${o.elapsedSeconds.toFixed(0)}s; ${o.samplesPerSecond.toFixed(1)} analyses/s; heap ${o.usedMB.toFixed(1)} MB; buffers ${o.buffersMB.toFixed(1)} MB`,
    );
    expect(state.calls).toBe(1);
    expect(o.usedMB).toBeLessThan(160);
    expect(o.buffersMB).toBeLessThan(100);
    if (now - started > 1890000) throw new Error('Automatic limit did not stop recording');
    if (await page.getByRole('button', { name: '停止麦克风' }).count()) {
      await page
        .getByRole('tab', { name: ['频谱图', '声谱图', '波形图'][observations.length % 3] })
        .click();
      if (observations.length === 2) await page.getByLabel('时间轴范围').selectOption('10');
    }
  }
  await expect(page.getByText('已达到 30 分钟，采集自动结束，完整结果已保留。')).toBeVisible();
  await expect(page.getByTestId('session-duration')).toHaveText('30:00.00');
  expect(Date.now() - started).toBeGreaterThanOrEqual(1800000);
  await download(page, '下载 WAV', '.local/recording-soak/30min.wav');
  const wav = await readFile('.local/recording-soak/30min.wav');
  expect(wav.length).toBe(172800044);
  expect(wav.readUInt32LE(40)).toBe(172800000);
  await download(page, '保存完整会话', '.local/recording-soak/30min.pitchsession');
  const archive = parse(await readFile('.local/recording-soak/30min.pitchsession'));
  expect(archive.manifest.duration).toBe(1800);
  expect(archive.blocks[2].equals(wav)).toBe(true);
  expect(archive.blocks[0].readDoubleLE(0)).toBeLessThan(2);
  expect(archive.blocks[1].length / 16).toBe(180000);
  await page.getByLabel('导入会话文件').setInputFiles('.local/recording-soak/30min.pitchsession');
  await expect(page.getByText('会话已打开，可回看与导出。')).toBeVisible();
  await page.getByLabel('定位历史').fill('0');
  await page.getByLabel('时间轴范围').selectOption('0');
  await page.getByRole('tab', { name: '声谱图' }).click();
  await page.getByLabel('图像范围').selectOption('whole');
  await download(page, '保存 PNG', '.local/recording-soak/30min.png');
  await page.getByLabel('录音回放').evaluate(async (e: HTMLAudioElement) => {
    e.currentTime = 1700;
    await e.play();
  });
  await page.waitForTimeout(500);
  expect(
    await page.getByLabel('录音回放').evaluate((e: HTMLAudioElement) => e.currentTime),
  ).toBeGreaterThan(1700);
  await page.getByLabel('录音回放').evaluate((e: HTMLAudioElement) => e.pause());
  expect(
    await page.evaluate(() =>
      (window as any).testAudio.allContexts.every((ctx: AudioContext) => ctx.state === 'closed'),
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: '.local/recording-soak/reopened.png', fullPage: true });
  await writeFile(
    '.local/recording-soak/result.json',
    JSON.stringify(
      {
        status: 'passed',
        browser: info.project.name,
        wallSeconds: (Date.now() - started) / 1000,
        wavBytes: wav.length,
        historyFrames: archive.blocks[0].length / 536,
        envelopes: archive.blocks[1].length / 16,
        observations,
        errors,
      },
      null,
      2,
    ),
  );
});

test('frozen history survives tab switches and resize, and interrupted analysis leaves gaps', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  await installAudioSource(page);
  await page.goto('/');
  await page.getByRole('button', { name: '开始录音' }).click();
  await expect(page.getByTestId('pitch-note')).toHaveText('A3');
  await page.waitForTimeout(600);
  await page.getByRole('tab', { name: '声谱图' }).click();
  await page.getByRole('button', { name: '冻结画面' }).click();
  const before = await page
    .getByTestId('time-spectrogram')
    .evaluate((e: HTMLCanvasElement) => e.toDataURL());
  await page.waitForTimeout(500);
  await page.getByRole('tab', { name: '波形图' }).click();
  await page.getByRole('tab', { name: '声谱图' }).click();
  expect(
    await page.getByTestId('time-spectrogram').evaluate((e: HTMLCanvasElement) => e.toDataURL()),
  ).toBe(before);
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.waitForTimeout(100);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.waitForTimeout(100);
  expect(
    await page.getByTestId('time-spectrogram').evaluate((e: HTMLCanvasElement) => e.toDataURL()),
  ).toBe(before);
  await page.getByRole('button', { name: '恢复实时' }).click();
  // Assert in audio-clock time: a busy host may suspend audio rendering itself.
  const pausedAt = await page.evaluate(() => {
    (window as any).testAudio.pauseAnalysis = true;
    return (window as any).testAudio.allContexts[0].currentTime;
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).testAudio.allContexts[0].currentTime), {
      timeout: 15000,
    })
    .toBeGreaterThan(pausedAt + 1);
  const samples = await page.evaluate(() => {
    (window as any).testAudio.pauseAnalysis = false;
    return (window as any).testAudio.samples;
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).testAudio.samples))
    .toBeGreaterThan(samples + 2);
  await page.getByRole('button', { name: '停止麦克风' }).click();
  await expect(page.getByRole('button', { name: '保存完整会话' })).toBeEnabled();
  const file = await download(page, '保存完整会话', info.outputPath('gap.pitchsession'));
  const archive = parse(await readFile(file));
  let gap = 0,
    previous = 0;
  for (let offset = 0; offset < archive.blocks[0].length; offset += 536) {
    const time = archive.blocks[0].readDoubleLE(offset);
    if (offset) gap = Math.max(gap, time - previous);
    previous = time;
  }
  await writeFile(
    info.outputPath('clock-log.json'),
    JSON.stringify(await page.evaluate(() => (window as any).testAudio.clockLog), null, 2),
  );
  expect(gap).toBeGreaterThan(0.7);
  expect(archive.blocks[1].length / 16).toBe(Math.ceil(archive.manifest.duration * 100 - 1e-8));
  expect(archive.blocks[2].length).toBe(44 + Math.round(archive.manifest.duration * 96000));
  await page.getByRole('button', { name: '开始录音' }).click();
  await expect(page.getByTestId('pitch-note')).toHaveText('A3');
  await page.getByRole('button', { name: '停止麦克风' }).click();
  await expect(page.getByRole('button', { name: '打开会话' })).toBeEnabled();
  await page.getByLabel('导入会话文件').setInputFiles(file);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('导入会话文件').setInputFiles(file);
  const saved = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存并继续' }).click();
  expect((await saved).suggestedFilename()).toMatch(/pitchsession$/);
  await expect(page.getByText('会话已打开，可回看与导出。')).toBeVisible();
});
