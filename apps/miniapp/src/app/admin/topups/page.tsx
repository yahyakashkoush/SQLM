'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, X } from 'lucide-react';
import { Badge, Button, Card, CardContent, Input } from '@sqlm/ui';
import { ApiError } from '@/lib/api';
import { adminApi, staffCan, type TopUp } from '@/lib/admin-api';
import { formatDate, formatMoney } from '@/lib/format';
import {
  AdminTitle,
  customerName,
  Empty,
  ListSkeleton,
  Receipt,
  Tabs,
} from '@/components/admin/admin-ui';

const TABS = [
  { value: 'PENDING', label: 'مستنية' },
  { value: 'APPROVED', label: 'اتقبلت' },
  { value: 'REJECTED', label: 'اترفضت' },
] as const;
const REASONS = ['التحويل موصلش', 'المبلغ مش مطابق', 'الإيصال مش واضح'];

export default function AdminTopUpsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['value']>('PENDING');
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'topups', tab],
    queryFn: () => adminApi.topUps(tab),
  });
  return (
    <>
      <AdminTitle
        title="شحن رصيد التجار"
        hint="بعد القبول الرصيد بيتضاف فوراً والتاجر بيوصله إشعار."
      />
      <Tabs value={tab} onChange={setTab} options={TABS} />
      {isLoading ? (
        <ListSkeleton />
      ) : !data?.length ? (
        <Empty>مفيش طلبات هنا.</Empty>
      ) : (
        data.map((t) => <TopUpCard key={t.id} topUp={t} />)
      )}
    </>
  );
}

function TopUpCard({ topUp: t }: { topUp: TopUp }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(String(Number(t.amount)));
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const review = useMutation({
    mutationFn: (approve: boolean) =>
      adminApi.reviewTopUp(
        t.id,
        approve ? { approve, amount: Number(amount) } : { approve, reason: reason.trim() },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'حصل خطأ'),
  });

  return (
    <Card>
      <CardContent className="space-y-3 p-4 text-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xl font-bold tabular-nums" dir="ltr">
              {formatMoney(t.amount, t.currency)}
            </p>
            {t.payAmount && (
              <p className="text-xs text-muted-foreground">
                المفروض اتحوّل {formatMoney(t.payAmount, t.payCurrency ?? t.currency)}
                {t.paymentMethod && ` على ${t.paymentMethod.name}`}
              </p>
            )}
            {t.senderReference && (
              <p className="text-xs text-muted-foreground">
                من <span dir="ltr">{t.senderReference}</span>
              </p>
            )}
          </div>
          <div className="text-end text-xs">
            <Link href={`/admin/customers/${t.customer.id}`} className="font-medium text-primary">
              🏪 {customerName(t.customer)}
            </Link>
            <p className="text-muted-foreground">
              رصيده {formatMoney(t.customer.walletBalance, t.currency)}
            </p>
            <p className="text-muted-foreground">{formatDate(t.createdAt)}</p>
          </div>
        </div>

        <Receipt queryKey={['admin', 'topup-url', t.id]} load={() => adminApi.topUpProof(t.id)} />

        {t.status !== 'PENDING' ? (
          <p className="text-xs text-muted-foreground">
            <Badge variant={t.status === 'APPROVED' ? 'success' : 'destructive'} className="me-1.5">
              {t.status === 'APPROVED' ? 'اتقبل' : 'اترفض'}
            </Badge>
            {t.reviewedBy?.name}
            {t.rejectReason && ` — ${t.rejectReason}`}
          </p>
        ) : (
          staffCan('payments.proofs.review') &&
          (rejecting ? (
            <div className="space-y-2 border-t pt-3">
              <div className="flex flex-wrap gap-1.5">
                {REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReason(r)}
                    className={`rounded-full border px-2.5 py-1 text-xs ${reason === r ? 'border-primary bg-primary/10' : ''}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="سبب الرفض"
              />
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  className="flex-1"
                  disabled={review.isPending || reason.trim().length < 2}
                  onClick={() => review.mutate(false)}
                >
                  رفض
                </Button>
                <Button variant="ghost" onClick={() => setRejecting(false)}>
                  رجوع
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2 border-t pt-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                يتضاف للرصيد
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-28"
                  dir="ltr"
                />
                {t.currency}
              </label>
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  disabled={review.isPending || !(Number(amount) > 0)}
                  onClick={() => review.mutate(true)}
                >
                  {review.isPending ? (
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="me-2 h-4 w-4" />
                  )}
                  قبول وشحن{' '}
                  {Number(amount) !== Number(t.amount) ? formatMoney(amount, t.currency) : ''}
                </Button>
                <Button variant="outline" onClick={() => setRejecting(true)}>
                  <X className="me-1 h-4 w-4" /> رفض
                </Button>
              </div>
            </div>
          ))
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
