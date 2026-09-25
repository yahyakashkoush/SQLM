/**
 * Minimal surface of Telegram's classic `telegram-web-app.js` global,
 * loaded via <script src="https://telegram.org/js/telegram-web-app.js">
 * in the root layout. Deliberately typed by hand against Telegram's
 * documented Bot API WebApp object rather than pulled in via a heavier
 * SDK package — this is a small, stable, years-old API surface, and
 * hand-typing it keeps the exact shape this app depends on visible in one
 * place (and easy to mock in tests: just set `window.Telegram`).
 */
export interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: TelegramWebAppUser };
  platform: string;
  colorScheme: 'light' | 'dark';
  ready(): void;
  expand(): void;
  close(): void;
  BackButton: {
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
  MainButton: {
    text: string;
    show(): void;
    hide(): void;
    enable(): void;
    disable(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
    setText(text: string): void;
  };
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
  };
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

export {};
