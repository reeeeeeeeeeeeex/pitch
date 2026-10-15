import { expect, test } from '@playwright/test';
import { installAudioSource } from './source';

test('language switches preserve capture, review state, and saved preferences', async ({
  page,
}, info) => {
  await installAudioSource(page);
  await page.goto('/');
  const language = page.getByLabel('Language / 语言');
  await language.selectOption('zh-CN');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('声见');
  await page.getByRole('button', { name: '开始录音' }).click();
  await expect(page.getByTestId('pitch-note')).toHaveText('A3');
  await page.getByRole('button', { name: '试听 C4', exact: true }).click();
  await page.getByRole('button', { name: '冻结画面', exact: true }).click();
  const before = await page.evaluate(() => (window as any).testAudio.samples);
  await language.selectOption('en');
  await expect(page.getByRole('button', { name: 'Resume display' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Play C4', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect
    .poll(() => page.evaluate(() => (window as any).testAudio.samples))
    .toBeGreaterThan(before);
  expect(
    await page.evaluate(() => ({
      calls: (window as any).testAudio.calls,
      stopped: (window as any).testAudio.stopped,
    })),
  ).toEqual({ calls: 1, stopped: 0 });
  await page.getByRole('button', { name: 'Stop microphone' }).click();
  await expect(page.getByRole('button', { name: 'Download WAV' })).toBeEnabled();
  const recording = await page.getByLabel('Recording playback').getAttribute('src');
  await language.selectOption('zh-CN');
  await expect(page.getByLabel('录音回放')).toHaveAttribute('src', recording!);
  await expect(page.getByTestId('cents')).toContainText('音分');
  await page.getByRole('tab', { name: '波形图' }).click();
  const image = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存 PNG', exact: true }).click();
  await (await image).saveAs(info.outputPath('chinese-export.png'));
  await expect(page.getByRole('button', { name: '保存完整会话', exact: true })).toBeEnabled();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存完整会话', exact: true }).click();
  const path = info.outputPath('bilingual.pitchsession');
  await (await downloaded).saveAs(path);
  await page.reload();
  await expect(language).toHaveValue('zh-CN');
  await expect(page.getByRole('button', { name: '开启麦克风' })).toBeVisible();
  await page.getByLabel('导入会话文件').setInputFiles(path);
  await expect(page.getByText('会话已打开，可回看与导出。')).toBeVisible();
  await language.selectOption('en');
  await expect(page.getByText('Session opened. You can now review and export it.')).toBeVisible();
  await page.getByRole('button', { name: 'Quick guide' }).click();
  await language.selectOption('zh-CN');
  await expect(page.getByText('三个简单的步骤')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('chinese-mobile.png'), fullPage: true });
});

test('existing errors update when the language changes', async ({ page }) => {
  await installAudioSource(page, 'denied');
  await page.goto('/');
  await page.getByRole('button', { name: 'Start microphone' }).click();
  await expect(page.getByRole('alert')).toContainText('Microphone access is blocked');
  await page.getByLabel('Language / 语言').selectOption('zh-CN');
  await expect(page.getByRole('alert')).toContainText('麦克风权限未开启');
  await page.getByLabel('Language / 语言').selectOption('en');
  await expect(page.getByRole('alert')).toContainText('Microphone access is blocked');
});
