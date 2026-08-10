'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { DEFAULT_LANG, LANGUAGES, isLangCode, type LangCode } from '@/i18n/types';
import { translate } from '@/i18n/dictionaries';

type Theme = 'light' | 'dark';

export const LANG_STORAGE_KEY = 'drepdao.lang';
export const THEME_STORAGE_KEY = 'drepdao.theme';

interface PrefsContextValue {
  lang: LangCode;
  setLang: (lang: LangCode) => void;
  /** Translate an English source string into the active language (English fallback). */
  t: (key: string) => string;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const PrefsContext = createContext<PrefsContextValue | null>(null);

function applyLang(lang: LangCode) {
  const meta = LANGUAGES.find((l) => l.code === lang);
  const el = document.documentElement;
  el.setAttribute('lang', lang);
  el.setAttribute('dir', meta?.rtl ? 'rtl' : 'ltr');
}
function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

/**
 * Holds the user's language + light/dark choice. Defaults are English + light; the actual
 * choice is read from localStorage after mount (the pre-hydration script in layout.tsx applies
 * the saved theme/lang to <html> before paint, so there's no flash and no hydration mismatch —
 * server and first client render both use the defaults, then this syncs to the saved value).
 */
export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<LangCode>(DEFAULT_LANG);
  const [theme, setThemeState] = useState<Theme>('light');

  useEffect(() => {
    try {
      const savedLang = localStorage.getItem(LANG_STORAGE_KEY);
      if (isLangCode(savedLang)) setLangState(savedLang);
      const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      if (savedTheme === 'dark' || savedTheme === 'light') setThemeState(savedTheme);
    } catch {
      /* localStorage unavailable (private mode / SSR) — keep defaults */
    }
  }, []);

  useEffect(() => { applyLang(lang); }, [lang]);
  useEffect(() => { applyTheme(theme); }, [theme]);

  const setLang = useCallback((next: LangCode) => {
    setLangState(next);
    try { localStorage.setItem(LANG_STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);
  const toggleTheme = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme, setTheme]);
  const t = useCallback((key: string) => translate(lang, key), [lang]);

  return (
    <PrefsContext.Provider value={{ lang, setLang, t, theme, setTheme, toggleTheme }}>
      {children}
    </PrefsContext.Provider>
  );
}

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs must be used within a PrefsProvider');
  return ctx;
}

/** Convenience hook for components that only need the translator. */
export function useT(): (key: string) => string {
  return usePrefs().t;
}
