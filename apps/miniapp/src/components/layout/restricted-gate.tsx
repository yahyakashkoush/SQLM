'use client';

import { Ban, PauseCircle } from 'lucide-react';
import { Button } from '@sqlm/ui';
import { useTelegram } from '@/components/providers/telegram-provider';
import { useStoreInfo } from '@/lib/queries';

/**
 * A suspended or banned customer sees why, until when, and one way out:
 * the appeal, which lives in the bot (it is the one channel still open
 * to them).
 */
export function RestrictedGate({ children }: { children: React.ReactNode }) {
  const { restriction } = useTelegram();
  const { data: store } = useStoreInfo();
  if (!restriction) return <>{children}</>;

  const bot = store?.botUsername ?? 'subsctech_bot';
  const openBot = () => {
    const url = `https://t.me/${bot}`;
    const webApp = window.Telegram?.WebApp as { openTelegramLink?: (u: string) => void; close?: () => void } | undefined;
    if (webApp?.openTelegramLink) {
      webApp.openTelegramLink(url);
      webApp.close?.();
    } else {
      window.location.href = url;
    }
  };
  const banned = restriction.kind === 'BANNED';
  const until = restriction.until
    ? new Date(restriction.until).toLocaleString('ar-EG', { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })
    : null;

  return (
    <main className="flex min-h-[80vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <div className={`flex h-16 w-16 items-center justify-center rounded-full ${banned ? 'bg-destructive/10' : 'bg-amber-500/10'}`}>
        {banned ? <Ban className="h-8 w-8 text-destructive" /> : <PauseCircle className="h-8 w-8 text-amber-600" />}
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">{banned ? 'حسابك موقوف' : 'حسابك موقوف مؤقتاً'}</h1>
        {until && <p className="text-sm text-muted-foreground">لحد {until}</p>}
      </div>
      <p className="max-w-sm rounded-lg border bg-card p-3 text-sm">{restriction.reason}</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        لو شايف إن ده حصل بالغلط، افتح البوت واضغط «📝 تقديم التماس» واكتب اللي حصل — بنراجع كل التماس بأنفسنا.
      </p>
      <Button size="lg" onClick={openBot}>
        📝 تقديم التماس من البوت
      </Button>
    </main>
  );
}
