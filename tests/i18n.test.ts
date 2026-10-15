import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLanguage, setLanguage, t, translateMessage } from '../src/i18n';
import chinese from '../src/i18n/zh-CN.json';

afterEach(() => {
  setLanguage('en');
  vi.unstubAllGlobals();
});

describe('language preferences and messages', () => {
  it('keeps every interpolation value in both languages', () => {
    for (const [english, translation] of Object.entries(chinese)) {
      expect(translation.match(/\{\d+\}/g)?.sort() ?? [], english).toEqual(
        english.match(/\{\d+\}/g)?.sort() ?? [],
      );
    }
    setLanguage('zh-CN');
    expect(t('Play {0}', 'C♯4')).toBe('试听 C♯4');
    expect(t('Offset from {0}', 'A3')).toBe('目标 A3 的偏差');
    expect(translateMessage('Not a supported .pitchsession file')).toBe(
      '不是支持的 .pitchsession 文件',
    );
    expect(translateMessage('Custom device diagnostic')).toBe('Custom device diagnostic');
  });

  it('switches for the session even if preference storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => setLanguage('zh-CN')).not.toThrow();
    expect(getLanguage()).toBe('zh-CN');
    expect(t('Start microphone')).toBe('开启麦克风');
    setLanguage('en');
    expect(t('Start microphone')).toBe('Start microphone');
  });
});
