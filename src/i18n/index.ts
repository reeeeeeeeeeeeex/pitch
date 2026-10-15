import { useSyncExternalStore } from 'react';
import chinese from './zh-CN.json';

export type Language = 'en' | 'zh-CN';
type MessageKey = keyof typeof chinese;
const STORAGE_KEY = 'pitch-studio.language';
const listeners = new Set<() => void>();

function initialLanguage(): Language {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'zh-CN' ? 'zh-CN' : 'en';
  } catch {
    return 'en';
  }
}

let language = initialLanguage();
export const getLanguage = () => language;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useLanguage() {
  return useSyncExternalStore(subscribe, getLanguage, getLanguage);
}

export function setLanguage(next: Language) {
  if (next !== 'en' && next !== 'zh-CN') return;
  language = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* Session-only if storage is blocked. */
  }
  updateDocumentLanguage();
  listeners.forEach((listener) => listener());
}

/** Translate app-owned copy only; session names and device labels stay untouched. */
export function t(key: MessageKey, ...values: (string | number)[]): string {
  const template = language === 'zh-CN' ? chinese[key] : key;
  return template.replace(/\{(\d+)\}/g, (placeholder, index: string) =>
    values[Number(index)] === undefined ? placeholder : String(values[Number(index)]),
  );
}

export function translateMessage(message: string): string {
  return Object.hasOwn(chinese, message) ? t(message as MessageKey) : message;
}

export function updateDocumentLanguage() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
  document.title = language === 'en' ? 'Pitch Studio' : '声见 · Pitch Studio';
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute(
      'content',
      t(
        'Explore your voice in real time with pitch tracking, a spectrum, a spectrogram, and waveforms. All audio is processed on your device.',
      ),
    );
}

updateDocumentLanguage();
