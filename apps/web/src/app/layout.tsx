import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';
import { PrefsProvider } from '@/lib/prefs-context';
import { LanguageThemeSwitcher } from '@/components/language-theme-switcher';
import { brand } from '@/lib/brand';

// Name + tab icon come from the deployment's brand (NEXT_PUBLIC_APP_NAME) — see lib/brand.ts.
export const metadata: Metadata = {
  title: brand.name,
  description: brand.description,
  icons: { icon: brand.icon, shortcut: brand.icon, apple: brand.icon },
};

// Apply the saved theme + language to <html> BEFORE first paint, so there's no flash of the
// wrong theme and no hydration mismatch. Defaults: light theme, English (LTR). Mirrors the
// storage keys in prefs-context.tsx. Runs synchronously, ahead of React.
const PREFS_BOOTSTRAP = `(function(){
  try{
    var t=localStorage.getItem('drepdao.theme');
    if(t==='dark')document.documentElement.classList.add('dark');
    var l=localStorage.getItem('drepdao.lang');
    if(l){document.documentElement.setAttribute('lang',l);
      document.documentElement.setAttribute('dir',l==='ar'?'rtl':'ltr');}
  }catch(e){}
})();`;

// Swallow errors thrown by browser extensions (MetaMask, etc.) injected into the
// page — they come from chrome-extension:// scripts, not our code, and would
// otherwise trip the Next dev error overlay. Registered before Next's handlers
// (inline, capture phase) so it can stop them; never matches real app errors.
const EXT_ERROR_GUARD = `(function(){
  var ext=function(s){return !!s&&(s.indexOf('chrome-extension://')>=0||s.indexOf('moz-extension://')>=0);};
  window.addEventListener('error',function(e){if(ext(e.filename)||(e.error&&ext(e.error.stack))){e.stopImmediatePropagation();e.preventDefault();}},true);
  window.addEventListener('unhandledrejection',function(e){var r=e.reason;var s=(r&&(r.stack||r.message))||String(r||'');if(ext(s)||/Failed to connect to MetaMask/i.test(s)){e.stopImmediatePropagation();e.preventDefault();}},true);
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* suppressHydrationWarning: browser extensions (Grammarly, etc.) inject
          attributes on <body> before React hydrates — harmless, not our markup. */}
      <body
        suppressHydrationWarning
        className="min-h-screen bg-neutral-50 text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100"
      >
        {/* eslint-disable-next-line @next/next/no-before-interactive-script-outside-document */}
        <script dangerouslySetInnerHTML={{ __html: EXT_ERROR_GUARD }} />
        {/* eslint-disable-next-line @next/next/no-before-interactive-script-outside-document */}
        <script dangerouslySetInnerHTML={{ __html: PREFS_BOOTSTRAP }} />
        <PrefsProvider>
          <LanguageThemeSwitcher />
          <AuthProvider>{children}</AuthProvider>
        </PrefsProvider>
      </body>
    </html>
  );
}
