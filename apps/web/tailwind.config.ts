import type { Config } from 'tailwindcss';

const config: Config = {
  // Class-based dark mode: the theme switcher toggles `class="dark"` on <html>, so the
  // user's choice (default light) wins over the OS preference. See prefs-context.tsx.
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
