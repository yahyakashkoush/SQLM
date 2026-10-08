'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  Clock,
  ImagePlus,
  Loader2,
  Plus,
  Store,
  Wallet,
} from 'lucide-react';
import { Badge, Button, Card, CardContent, Input, Skeleton } from '@sqlm/ui';
import { api, ApiError } from '@/lib/api';
import { useWallet, useWalletTopUps } from '@/lib/queries';
import { formatDate, formatMoney } from '@/lib/format';
import { CopyButton } from '@/components/copy-button';
import { PaymentLogo } from '@/components/payment-logo';
import type { TopUpMethod, WalletEntryType } from '@/types/api';

const ENTRY_LABEL: Record<WalletEntryType, string> = {
  TOPUP: 'شحن رصيد',
  PURCHASE: 'شراء',
  REFUND: 'استرداد',
  ADJUSTMENT: 'تسوية من الإدارة',
};
const PRESETS = [25, 50, 100, 250];
const STATUS: Record<string, { label: string; variant: 'warning' | 'success' | 'destructive' }> = {
  PENDING: { label: 'بيتراجع', variant: 'warning' },
  APPROVED: { label: 'اتشحن', variant: 'success' },
  REJECTED: { label: 'اترفض', variant: 'destructive' },
};

export default function WalletPage() {
  const wallet = useWallet();
  const topUps = useWalletTopUps(Boolean(wallet.data?.enabled));
  const [toppingUp, setToppingUp] = useState(false);

  if (wallet.isLoading || !wallet.data) {
    return (
      <main className="space-y-4 p-4">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </main>
    );
  }

  const w = wallet.data;
  if (!w.enabled) {
    return (
      <main className="flex flex-col items-center gap-4 p-6 pt-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <Wallet className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-lg font-semibold">المحفظة لتجار الجملة</h1>
        <p className="max-w-xs text-sm text-muted-foreground">
          بعد ما عضوية الجملة بتاعتك تتقبل، تقدر تشحن رصيد مرة واحدة وتشتري بيه على طول من غير ما
          تبعت إيصال لكل طلب.
        </p>
        <Button asChild>
          <Link href="/wholesale">
            <Store className="me-2 h-4 w-4" /> قدّم على عضوية الجملة
          </Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-5 p-4">
      <section className="relative overflow-hidden rounded-2xl bg-primary p-5 text-primary-foreground shadow-lg">
        <div className="absolute -left-10 -top-10 h-36 w-36 rounded-full bg-white/10" aria-hidden />
        <div
          className="absolute -bottom-12 left-16 h-28 w-28 rounded-full bg-white/5"
          aria-hidden
        />
        <p className="relative text-sm opacity-80">رصيد المحفظة</p>
        <p className="relative mt-1 text-4xl font-bold tabular-nums tracking-tight" dir="ltr">
          {formatMoney(w.balance, w.currency)}
        </p>
        {w.pendingTopUps.length > 0 && (
          <p className="relative mt-2 flex items-center gap-1 text-xs opacity-90">
            <Clock className="h-3.5 w-3.5" />
            {w.pendingTopUps.length} طلب شحن بيتراجع (
            {formatMoney(
              w.pendingTopUps.reduce((sum, t) => sum + Number(t.amount), 0),
              w.currency,
            )}
            )
          </p>
        )}
        {!toppingUp && (
          <Button
            variant="secondary"
            className="relative mt-4 w-full"
            onClick={() => setToppingUp(true)}
          >
            <Plus className="me-2 h-4 w-4" /> شحن الرصيد
          </Button>
        )}
      </section>

      {toppingUp && <TopUpFlow currency={w.currency} onDone={() => setToppingUp(false)} />}

      {topUps.data && topUps.data.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">طلبات الشحن</h2>
          <Card>
            <CardContent className="divide-y p-0">
              {topUps.data.slice(0, 5).map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium tabular-nums">{formatMoney(t.amount, t.currency)}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(t.createdAt)}
                      {t.paymentMethod ? ` · ${t.paymentMethod.name}` : ''}
                    </p>
                    {t.rejectReason && <p className="text-xs text-destructive">{t.rejectReason}</p>}
                  </div>
                  <Badge variant={STATUS[t.status]!.variant}>{STATUS[t.status]!.label}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">آخر الحركات</h2>
        {w.entries.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            لسه مفيش حركات على المحفظة.
          </p>
        ) : (
          <Card>
            <CardContent className="divide-y p-0">
              {w.entries.map((e) => {
                const credit = Number(e.amount) >= 0;
                const row = (
                  <div className="flex items-center gap-3 p-3 text-sm">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${credit ? 'bg-success/15 text-success' : 'bg-muted text-foreground'}`}
                    >
                      {credit ? (
                        <ArrowDownLeft className="h-4 w-4" />
                      ) : (
                        <ArrowUpRight className="h-4 w-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {ENTRY_LABEL[e.type]}
                        {e.order && (
                          <span className="text-muted-foreground">
                            {' '}
                            · طلب #{e.order.sequenceNumber}
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatDate(e.createdAt)}
                        {e.note && !e.order ? ` · ${e.note}` : ''}
                      </p>
                    </div>
                    <div className="text-end">
                      <p
                        className={`font-semibold tabular-nums ${credit ? 'text-success' : ''}`}
                        dir="ltr"
                      >
                        {credit ? '+' : '−'}
                        {formatMoney(Math.abs(Number(e.amount)), e.currency)}
                      </p>
                      <p className="text-[11px] text-muted-foreground tabular-nums" dir="ltr">
                        {formatMoney(e.balanceAfter, e.currency)}
                      </p>
                    </div>
                  </div>
                );
                return e.order ? (
                  <Link key={e.id} href={`/orders/${e.order.id}`} className="block">
                    {row}
                  </Link>
                ) : (
                  <div key={e.id}>{row}</div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </section>
    </main>
  );
}

/** Amount → how to pay → receipt. Each step can go back; nothing is sent until the last one. */
function TopUpFlow({ currency, onDone }: { currency: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<TopUpMethod | null>(null);
  const [sender, setSender] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const value = Number(amount);
  const validAmount = Number.isFinite(value) && value >= 1 && value <= 100_000;

  const methods = useQuery({
    queryKey: ['topup-quote', value],
    queryFn: () => api.topUpQuote(Math.round(value * 100) / 100),
    enabled: step >= 2 && validAmount,
  });

  const submit = useMutation({
    mutationFn: () =>
      api.createTopUp({
        amount: Math.round(value * 100) / 100,
        paymentMethodId: method!.id,
        senderReference: sender,
        file: file!,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet-topups'] });
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');
      onDone();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني'),
  });

  return (
    <Card className="border-primary/30">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">شحن الرصيد</p>
          <div className="flex gap-1" aria-label={`خطوة ${step} من 3`}>
            {[1, 2, 3].map((n) => (
              <span
                key={n}
                className={`h-1.5 w-6 rounded-full ${n <= step ? 'bg-primary' : 'bg-muted'}`}
              />
            ))}
          </div>
        </div>

        {step === 1 && (
          <>
            <p className="text-xs text-muted-foreground">عايز تشحن كام؟ ({currency})</p>
            <div className="grid grid-cols-4 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setAmount(String(p))}
                  className={`rounded-lg border py-2 text-sm font-medium tabular-nums ${value === p ? 'border-primary bg-primary/10 text-primary' : ''}`}
                >
                  {p}
                </button>
              ))}
            </div>
            <Input
              type="number"
              inputMode="decimal"
              min="1"
              placeholder="أو اكتب مبلغ تاني"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              dir="ltr"
            />
            <div className="flex gap-2">
              <Button className="flex-1" disabled={!validAmount} onClick={() => setStep(2)}>
                التالي
              </Button>
              <Button variant="ghost" onClick={onDone}>
                إلغاء
              </Button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <p className="text-xs text-muted-foreground">
              هتحوّل {formatMoney(value, currency)} إزاي؟
            </p>
            {methods.isLoading ? (
              <Skeleton className="h-28 w-full" />
            ) : methods.data?.length ? (
              <div className="space-y-2">
                {methods.data.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => (setMethod(m), setStep(3))}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-start transition hover:border-primary"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <PaymentLogo src={m.logoUrl} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{m.name}</p>
                        {m.description && (
                          <p className="truncate text-xs text-muted-foreground">{m.description}</p>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums" dir="ltr">
                      {formatMoney(m.payAmount, m.payCurrency)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">مفيش طرق دفع متاحة للشحن دلوقتي.</p>
            )}
            <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
              <ChevronRight className="me-1 h-4 w-4" /> رجوع
            </Button>
          </>
        )}

        {step === 3 && method && (
          <>
            <div className="space-y-2 rounded-xl bg-muted p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">حوّل بالظبط</span>
                <span className="flex items-center gap-2">
                  <span className="font-bold tabular-nums" dir="ltr">
                    {formatMoney(method.payAmount, method.payCurrency)}
                  </span>
                  <CopyButton value={String(Number(method.payAmount))} />
                </span>
              </div>
              {method.accountNumber && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">على {method.name}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-medium" dir="ltr">
                      {method.accountNumber}
                    </span>
                    <CopyButton value={method.accountNumber} />
                  </span>
                </div>
              )}
              {method.instructions && (
                <p className="whitespace-pre-line text-xs text-muted-foreground">
                  {method.instructions}
                </p>
              )}
            </div>
            <label className="block space-y-1 text-xs text-muted-foreground">
              الرقم أو الحساب اللي حوّلت منه
              <Input
                value={sender}
                onChange={(e) => setSender(e.target.value)}
                placeholder="01xxxxxxxxx"
                dir="ltr"
                inputMode="tel"
              />
            </label>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed p-3 text-sm">
              <ImagePlus className="h-5 w-5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate">
                {file ? file.name : 'ارفع صورة إيصال التحويل'}
              </span>
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={!file || submit.isPending}
                onClick={() => (setError(null), submit.mutate())}
              >
                {submit.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                ابعت طلب الشحن
              </Button>
              <Button variant="ghost" onClick={() => setStep(2)}>
                رجوع
              </Button>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              الرصيد بيتضاف أول ما الإدارة تتأكد من التحويل، وهيوصلك إشعار في البوت. الإيصال المكرر
              أو المزيف بيوقف الحساب.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
