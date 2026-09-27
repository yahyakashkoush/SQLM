'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, TimerOff } from 'lucide-react';
import { Card, CardContent } from '@sqlm/ui';
import { CopyButton } from '@/components/copy-button';
import { useCryptoPayment } from '@/lib/queries';

/** Human network names; the raw exchange codes mean nothing to a customer. */
const NETWORK_LABELS: Record<string, string> = {
  TRX: 'TRC20 (Tron)',
  BSC: 'BEP20 (BNB Smart Chain)',
  ETH: 'ERC20 (Ethereum)',
  SOL: 'Solana',
  MATIC: 'Polygon',
  ARBITRUM: 'Arbitrum',
  TON: 'TON',
  INTERNAL: 'تحويل داخلي',
};

function useCountdown(expiresAt?: string) {
  const [remaining, setRemaining] = useState<number>(() =>
    expiresAt ? Math.max(0, new Date(expiresAt).getTime() - Date.now()) : 0,
  );

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setRemaining(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const totalSeconds = Math.floor(remaining / 1000);
  return {
    expired: remaining <= 0,
    label: `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`,
  };
}

export function CryptoPaymentCard({ orderId, methodName }: { orderId: string; methodName: string }) {
  const { data, isLoading, error } = useCryptoPayment(orderId, true);
  const countdown = useCountdown(data?.expiresAt);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> جاري تجهيز بيانات الدفع…
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="p-4 text-sm text-destructive">
          تعذّر تجهيز بيانات الدفع. جرّب تحدّث الصفحة أو كلّم الدعم.
        </CardContent>
      </Card>
    );
  }

  if (data.status === 'MATCHED') {
    return (
      <Card className="border-success/40">
        <CardContent className="flex items-center gap-2 p-4 text-sm">
          <CheckCircle2 className="h-5 w-5 text-success" />
          <span className="font-medium">وصل التحويل وتم تأكيد الدفع تلقائياً ✓</span>
        </CardContent>
      </Card>
    );
  }

  if (data.status === 'EXPIRED' || data.status === 'CANCELLED') {
    return (
      <Card className="border-destructive/40">
        <CardContent className="flex gap-2 p-4 text-sm">
          <TimerOff className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-destructive">انتهت مهلة الدفع لهذا الطلب</p>
            <p className="text-xs text-muted-foreground">
              لو حوّلت المبلغ بالفعل، كلّم الدعم ومعاك رقم العملية وهنراجعه يدوياً.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const network = NETWORK_LABELS[data.network] ?? data.network;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">الدفع عن طريق {methodName}</p>
          {!countdown.expired && (
            <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs" dir="ltr">
              {countdown.label}
            </span>
          )}
        </div>

        {/* The delta in the last decimals is what identifies this order, so
            sending a rounded amount means nothing matches. Say so plainly. */}
        <div className="flex items-center justify-between gap-2 rounded-lg border-2 border-primary/40 bg-primary/5 p-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">ابعت المبلغ ده بالظبط</p>
            <p dir="ltr" className="break-all text-start font-mono text-xl font-bold">
              {data.amount}
            </p>
            <p className="text-xs text-muted-foreground">{data.asset}</p>
          </div>
          <CopyButton value={data.amount} label="نسخ" />
        </div>

        <div className="flex items-center justify-between gap-2 rounded-lg bg-muted p-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">عنوان المحفظة</p>
            <p dir="ltr" className="break-all text-start font-mono text-sm font-semibold">
              {data.address}
            </p>
          </div>
          <CopyButton value={data.address} />
        </div>

        <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="space-y-1">
            <p>
              استخدم شبكة <span className="font-semibold">{network}</span> بس. أي شبكة تانية والفلوس
              ممكن تضيع.
            </p>
            <p>
              لازم يكون المبلغ <span className="font-semibold">بالأرقام العشرية كلها</span> زي ما هو
              فوق — ده اللي بنعرف بيه طلبك.
            </p>
          </div>
        </div>

        {data.autoConfirmActive ? (
          <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            بنراقب التحويل — الطلب هيتأكد لوحده خلال دقايق من وصوله.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            بعد التحويل ارفع صورة الإيصال من تحت عشان نراجعه.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
