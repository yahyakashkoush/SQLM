'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';
import { Button, Card, CardContent, Input } from '@sqlm/ui';
import { ApiError } from '@/lib/api';
import { adminApi, staffCan, type PendingProof } from '@/lib/admin-api';
import { formatMoney } from '@/lib/format';
import {
  AdminTitle,
  customerName,
  Empty,
  ListSkeleton,
  Receipt,
} from '@/components/admin/admin-ui';

/** The same canned reasons as the bot; "not clear" never counts as a strike. */
const REASONS = [
  'المبلغ المحوّل ناقص',
  'الإيصال مش واضح',
  'التحويل موصلش لحسابنا',
  'الإيصال مش خاص بالطلب ده',
];

export default function AdminProofsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'proofs'],
    queryFn: adminApi.proofs,
    refetchInterval: 30_000,
  });
  return (
    <>
      <AdminTitle
        title="الإيصالات"
        hint="اتأكد من التحويل على كشف الحساب قبل القبول. القبول بيسلّم الطلب على طول."
      />
      {isLoading ? (
        <ListSkeleton />
      ) : !data?.length ? (
        <Empty>مفيش إيصالات مستنية 🎉</Empty>
      ) : (
        data.map((p) => <ProofCard key={p.id} proof={p} />)
      )}
    </>
  );
}

function ProofCard({ proof: p }: { proof: PendingProof }) {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [cancel, setCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin'] });
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');
  };
  const approve = useMutation({
    mutationFn: () => adminApi.approveProof(p.id),
    onSuccess: done,
    onError: (e) => setError(msg(e)),
  });
  const reject = useMutation({
    mutationFn: () => adminApi.rejectProof(p.id, reason.trim(), cancel),
    onSuccess: done,
    onError: (e) => setError(msg(e)),
  });
  const busy = approve.isPending || reject.isPending;
  const transfer = p.order.payAmount
    ? formatMoney(p.order.payAmount, p.order.payCurrency ?? p.order.currency)
    : formatMoney(p.order.total, p.order.currency);

  return (
    <Card>
      <CardContent className="space-y-3 p-4 text-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link href={`/admin/orders/${p.orderId}`} className="font-semibold text-primary">
              طلب #{p.order.sequenceNumber}
            </Link>
            <p className="text-xs text-muted-foreground">
              {customerName(p.customer)} · {p.order.paymentMethod?.name ?? '—'}
            </p>
          </div>
          <div className="text-end">
            <p className="font-bold tabular-nums" dir="ltr">
              {transfer}
            </p>
            {p.senderReference && (
              <p className="text-xs text-muted-foreground" dir="ltr">
                من {p.senderReference}
              </p>
            )}
          </div>
        </div>

        {p.risk.flags.length > 0 && (
          <div className="space-y-1 rounded-lg border border-warning/50 bg-warning/10 p-2 text-xs">
            {p.risk.flags.map((f) => (
              <p key={f} className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" /> {f}
              </p>
            ))}
          </div>
        )}

        <Receipt
          queryKey={['admin', 'proof-url', p.id]}
          load={async () => ({ ...(await adminApi.proofUrl(p.id)), mimeType: p.mimeType })}
        />

        {staffCan('payments.proofs.review') &&
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
                placeholder="سبب الرفض (بيوصل للعميل)"
              />
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={cancel}
                  onChange={(e) => setCancel(e.target.checked)}
                />
                إلغاء الطلب كمان (إيصال مزيف — بيتحسب مخالفة)
              </label>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  className="flex-1"
                  disabled={busy || reason.trim().length < 2}
                  onClick={() => reject.mutate()}
                >
                  {reject.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />} رفض
                </Button>
                <Button variant="ghost" onClick={() => setRejecting(false)}>
                  رجوع
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button className="flex-1" disabled={busy} onClick={() => approve.mutate()}>
                {approve.isPending ? (
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="me-2 h-4 w-4" />
                )}{' '}
                قبول وتسليم
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setRejecting(true)}>
                <X className="me-1 h-4 w-4" /> رفض
              </Button>
            </div>
          ))}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'حصل خطأ');
