'use client';

import { LANGUAGES, isLangCode } from '@/i18n/types';
import { usePrefs } from '@/lib/prefs-context';

/**
 * Fixed top-right toolbar: a language picker (top 12 languages) and a light/dark toggle.
 * Rendered once in the root layout so it sits in the corner on every screen (logged in or out).
 */
export function LanguageThemeSwitcher() {
  const { lang, setLang, theme, toggleTheme, t } = usePrefs();
  return (
    <div className="fixed right-3 top-2 z-50 flex items-center gap-1.5">
      <select
        aria-label={t('Language')}
        title={t('Language')}
        value={lang}
        onChange={(e) => { if (isLangCode(e.target.value)) setLang(e.target.value); }}
        className="rounded-md border border-neutral-300 bg-white/90 px-2 py-1 text-xs shadow-sm backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/90 dark:text-neutral-100"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{l.short} · {l.label}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={toggleTheme}
        title={theme === 'dark' ? t('Light') : t('Dark')}
        aria-label={t('Theme')}
        className="rounded-md border border-neutral-300 bg-white/90 px-2 py-1 text-sm leading-none shadow-sm backdrop-blur hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900/90 dark:hover:bg-neutral-800"
      >
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>
    </div>
  );
}
