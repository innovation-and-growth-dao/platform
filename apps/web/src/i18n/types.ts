// Supported UI languages. English is the source language: every translatable string is
// written in English in the code and used verbatim as the dictionary key, so an untranslated
// string always falls back to readable English (never a bare key like "nav.myArea").
export type LangCode =
  | 'en' // English
  | 'es' // Spanish
  | 'zh' // Chinese (Simplified)
  | 'ja' // Japanese
  | 'de' // German
  | 'ru' // Russian
  | 'it' // Italian
  | 'fr' // French
  | 'pt' // Portuguese
  | 'ko' // Korean
  | 'ar' // Arabic (RTL)
  | 'hi'; // Hindi

export interface LangMeta {
  code: LangCode;
  /** Endonym — the language's own name, shown in the switcher. */
  label: string;
  /** Short code shown on the compact switcher button. */
  short: string;
  /** Right-to-left script (Arabic). Sets <html dir="rtl">. */
  rtl?: boolean;
}

// The top-12 set. Order = how they appear in the switcher (English first).
export const LANGUAGES: LangMeta[] = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'es', label: 'Español', short: 'ES' },
  { code: 'zh', label: '中文', short: '中' },
  { code: 'ja', label: '日本語', short: '日' },
  { code: 'de', label: 'Deutsch', short: 'DE' },
  { code: 'ru', label: 'Русский', short: 'RU' },
  { code: 'it', label: 'Italiano', short: 'IT' },
  { code: 'fr', label: 'Français', short: 'FR' },
  { code: 'pt', label: 'Português', short: 'PT' },
  { code: 'ko', label: '한국어', short: '한' },
  { code: 'ar', label: 'العربية', short: 'ع', rtl: true },
  { code: 'hi', label: 'हिन्दी', short: 'हि' },
];

export const DEFAULT_LANG: LangCode = 'en';
export const LANG_CODES = LANGUAGES.map((l) => l.code);
export function isLangCode(v: unknown): v is LangCode {
  return typeof v === 'string' && (LANG_CODES as string[]).includes(v);
}

/** A translation dictionary: English source string → translated string. */
export type Dict = Record<string, string>;
