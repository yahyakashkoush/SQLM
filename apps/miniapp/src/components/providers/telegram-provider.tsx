'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import Script from 'next/script';
import { useAuthStore } from '@/store/auth-store';
import { api, ApiError, setTelegramInitData } from '@/lib/api';

export interface Restriction {
  kind: 'BANNED' | 'SUSPENDED';
  reason: string;
  until: string | null;
}

interface TelegramContextValue {
  ready: boolean;
  inTelegram: boolean;
  authError: string | null;
  restriction: Restriction | null;
}

const TelegramContext = createContext<TelegramContextValue>({
  ready: false,
  inTelegram: false,
  authError: null,
  restriction: null,
});

export const useTelegram = () => useContext(TelegramContext);

/**
 * Loads Telegram's classic WebApp script, calls ready()/expand(), and
 * authenticates against the backend using initData the moment it's
 * available. Every other page in this app assumes auth has already been
 * attempted by the time it renders — this is the one place that logic
 * lives.
 */
export function TelegramProvider({ children }: { children: React.ReactNode }) {
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const [inTelegram, setInTelegram] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [restriction, setRestriction] = useState<Restriction | null>(null);
  const setSession = useAuthStore((s) => s.setSession);
  const hasSession = useAuthStore((s) => Boolean(s.accessToken));

  useEffect(() => {
    if (!scriptLoaded) return;

    const webApp = window.Telegram?.WebApp;
    if (!webApp) {
      setReady(true);
      return;
    }

    webApp.ready();
    webApp.expand();
    setInTelegram(true);

    // Hand initData to the API client before the early return below: a
    // stored token may already be expired, and this is what lets the
    // client mint a new one when the first authenticated call is refused.
    setTelegramInitData(webApp.initData || null);

    if (hasSession) {
      setReady(true);
      return;
    }

    if (!webApp.initData) {
      setAuthError('تعذر قراءة بيانات تيليجرام — افتح التطبيق من زر المتجر في البوت.');
      setReady(true);
      return;
    }

    api
      .authenticateTelegram(webApp.initData)
      .then((res) => {
        setSession(res.accessToken, res.customer);
        setReady(true);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && (err.code === 'ACCOUNT_SUSPENDED' || err.code === 'ACCOUNT_BANNED')) {
          setRestriction({
            kind: err.code === 'ACCOUNT_BANNED' ? 'BANNED' : 'SUSPENDED',
            reason: err.message,
            until: err.until ?? null,
          });
          setAuthError('حسابك موقوف حالياً.');
          setReady(true);
          return;
        }
        const suspended = err instanceof ApiError && /suspended|not active/i.test(err.message);
        setAuthError(
          suspended
            ? '🚫 حسابك في المتجر موقوف بسبب مخالفة شروط الاستخدام. للاستفسار تواصل مع الدعم.'
            : err instanceof ApiError
              ? err.message
              : 'تعذر تسجيل الدخول، أعد فتح التطبيق.',
        );
        setReady(true);
      });
  }, [scriptLoaded, hasSession, setSession]);

  return (
    <TelegramContext.Provider value={{ ready, inTelegram, authError, restriction }}>
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="afterInteractive"
        onLoad={() => setScriptLoaded(true)}
        onError={() => setScriptLoaded(true)}
      />
      {children}
    </TelegramContext.Provider>
  );
}
