import type { Config } from 'tailwindcss';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharedPreset = require('@sqlm/ui/tailwind-preset');

const config: Config = {
  presets: [sharedPreset],
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: 'rgb(var(--paper) / <alpha-value>)',
        'paper-deep': 'rgb(var(--paper-deep) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        'ink-soft': 'rgb(var(--ink-soft) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        tg: 'rgb(var(--tg) / <alpha-value>)',
        'tg-deep': 'rgb(var(--tg-deep) / <alpha-value>)',
        saffron: 'rgb(var(--saffron) / <alpha-value>)',
      },
      fontFamily: {
        display: ['Alexandria', 'IBM Plex Sans Arabic', 'system-ui', 'sans-serif'],
        sans: ['IBM Plex Sans Arabic', 'system-ui', '-apple-system', 'Segoe UI', 'Tahoma', 'sans-serif'],
      },
      maxWidth: { site: '72rem' },
    },
  },
};

export default config;
