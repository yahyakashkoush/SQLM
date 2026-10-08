'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Loader2 } from 'lucide-react';
import { ORDER_STATUS_LABELS_AR, ORDER_TRANSITIONS, type OrderStatus } from '@sqlm/shared';
import { Button, Card, CardContent, Input, Skeleton } from '@sqlm/ui';
import { ApiError } from '@/lib/api';
import { adminApi, staffCan, type OrderDelivery } from '@/lib/admin-api';
import { formatDate, formatMoney } from '@/lib/format';
import { customerName } from '@/components/admin/admin-ui';
import { OrderStatusBadge } from '@/components/orders/order-status-badge';

/** Destructive moves get a red button and a confirm tap. */
const DANGEROUS: OrderStatus[] = ['CANCELLED', 'REFUNDED', 'DISPUTED'];

export default function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const { data: o, isLoading } = useQuery({
    queryKey: ['admin', 'order', id],
    queryFn: () => adminApi.order(id),
  });
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState<OrderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const move = useMutation({
    mutationFn: (to: OrderStatus) => adminApi.transition(id, to, note.trim() || undefined),
    onSuccess: () => {
      setConfirm(null);
      setNote('');
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'حصل خطأ'),
  });

  if (isLoading || !o) return <Skeleton className="h-72 w-full rounded-xl" />;
  const next = (ORDER_TRANSITIONS[o.status as OrderStatus] ?? []).filter(
    (s) => s !== 'PAID' || o.status !== 'PAYMENT_REVIEW',
  );

  return (
    <>
      <Link
        href="/admin/orders"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground"
      >
        <ChevronRight className="h-4 w-4" /> الطلبات
      </Link>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">طلب #{o.sequenceNumber}</h1>
        <OrderStatusBadge status={o.status as OrderStatus} />
      </div>

      <Card>
        <CardContent className="space-y-2 p-4 text-sm">
          {o.items.map((i) => (
            <div key={i.id} className="flex justify-between gap-2">
              <span>
                {i.productNameSnapshot}
                {i.bundleLabel ? (
                  <span className="text-muted-foreground"> · {i.bundleLabel}</span>
                ) : i.quantity > 1 ? (
                  ` ×${i.quantity}`
                ) : (
                  ''
                )}
              </span>
              <span className="tabular-nums" dir="ltr">
                {formatMoney(i.lineTotal ?? Number(i.unitPrice) * i.quantity, o.currency)}
              </span>
            </div>
          ))}
          {Number(o.discountTotal) > 0 && (
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>خصم{o.couponCode ? ` (${o.couponCode})` : ''}</span>
              <span dir="ltr">−{formatMoney(o.discountTotal, o.currency)}</span>
            </div>
          )}
          <div className="flex justify-between border-t pt-2 font-semibold">
            <span>الإجمالي</span>
            <span dir="ltr">
              {formatMoney(o.total, o.currency)}
              {o.payAmount && (
                <span className="ms-1 text-xs font-normal text-muted-foreground">
                  ({formatMoney(o.payAmount, o.payCurrency ?? o.currency)})
                </span>
              )}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {formatDate(o.createdAt)} ·{' '}
            {o.walletPaid ? '💳 مدفوع من المحفظة' : (o.paymentMethod?.name ?? 'بدون طريقة دفع')}
            {o.paidAt && ` · اتدفع ${formatDate(o.paidAt)}`}
          </p>
          {o.cancelReason && (
            <p className="text-xs text-destructive">سبب الإلغاء: {o.cancelReason}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-1 p-4 text-sm">
          <Link href={`/admin/customers/${o.customer.id}`} className="font-medium text-primary">
            👤 {customerName(o.customer)}
          </Link>
          {o.customer.telegramUsername && (
            <p className="text-xs text-muted-foreground" dir="ltr">
              @{o.customer.telegramUsername}
            </p>
          )}
          {o.customer.contactPhone && (
            <a
              href={`tel:${o.customer.contactPhone}`}
              className="block text-xs text-primary"
              dir="ltr"
            >
              {o.customer.contactPhone}
            </a>
          )}
        </CardContent>
      </Card>

      {o.paymentProofs.length > 0 && (
        <Card>
          <CardContent className="space-y-1 p-4 text-xs">
            <p className="text-sm font-medium">الإيصالات</p>
            {o.paymentProofs.map((p) => (
              <p key={p.id} className="text-muted-foreground">
                {formatDate(p.uploadedAt)} ·{' '}
                {p.status === 'PENDING'
                  ? 'مستني مراجعة'
                  : p.status === 'APPROVED'
                    ? 'اتقبل'
                    : `اترفض${p.rejectionReason ? `: ${p.rejectionReason}` : ''}`}
                {p.senderReference && ` · من ${p.senderReference}`}
              </p>
            ))}
            {o.paymentProofs.some((p) => p.status === 'PENDING') && (
              <Link href="/admin/proofs" className="text-primary underline">
                راجع الإيصال
              </Link>
            )}
          </CardContent>
        </Card>
      )}

      {staffCan('delivery.read') && <Deliveries orderId={o.id} />}

      {staffCan('orders.transition') && next.length > 0 && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm font-medium">نقل الطلب إلى</p>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="ملاحظة (اختياري)"
            />
            <div className="flex flex-wrap gap-2">
              {next.map((s) => {
                const danger = DANGEROUS.includes(s);
                if (confirm === s) {
                  return (
                    <Button
                      key={s}
                      size="sm"
                      variant="destructive"
                      disabled={move.isPending}
                      onClick={() => move.mutate(s)}
                    >
                      {move.isPending && <Loader2 className="me-1 h-4 w-4 animate-spin" />} أكيد؟{' '}
                      {ORDER_STATUS_LABELS_AR[s]}
                    </Button>
                  );
                }
                return (
                  <Button
                    key={s}
                    size="sm"
                    variant={danger ? 'outline' : 'default'}
                    className={danger ? 'border-destructive/50 text-destructive' : ''}
                    disabled={move.isPending}
                    onClick={() => (danger ? setConfirm(s) : move.mutate(s))}
                  >
                    {ORDER_STATUS_LABELS_AR[s]}
                  </Button>
                );
              })}
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </CardContent>
        </Card>
      )}
    </>
  );
}

/** Items waiting for a person to send them: type the account / code and it goes to the customer in Telegram. */
function Deliveries({ orderId }: { orderId: string }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['admin', 'deliveries', orderId],
    queryFn: () => adminApi.deliveries(orderId),
  });
  if (!data?.length) return null;
  return (
    <Card>
      <CardContent className="space-y-3 p-4 text-sm">
        <p className="font-medium">التسليم</p>
        {data.map((d) =>
          d.status === 'DELIVERED' ? (
            <p key={d.id} className="text-xs text-success">
              ✅ {d.orderItem.productNameSnapshot} — اتسلّم{' '}
              {d.deliveredAt ? formatDate(d.deliveredAt) : ''}
            </p>
          ) : (
            <ManualDelivery
              key={d.id}
              delivery={d}
              onDone={() => void queryClient.invalidateQueries({ queryKey: ['admin'] })}
            />
          ),
        )}
      </CardContent>
    </Card>
  );
}

function ManualDelivery({ delivery: d, onDone }: { delivery: OrderDelivery; onDone: () => void }) {
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => adminApi.fulfill(d.id, content.trim()),
    onSuccess: onDone,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'حصل خطأ'),
  });
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-xs">
        ⏳ <span className="font-medium">{d.orderItem.productNameSnapshot}</span>
        {d.orderItem.quantity > 1 && ` ×${d.orderItem.quantity}`}
        {d.lastError && <span className="text-destructive"> · {d.lastError}</span>}
      </p>
      {staffCan('delivery.fulfill') && (
        <>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            dir="auto"
            className="w-full rounded-md border bg-background p-2 font-mono text-xs"
            placeholder={'email: …\npassword: …'}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button
            size="sm"
            className="w-full"
            disabled={send.isPending || content.trim().length < 2}
            onClick={() => send.mutate()}
          >
            {send.isPending && <Loader2 className="me-1 h-4 w-4 animate-spin" />} سلّم للعميل في
            تيليجرام
          </Button>
        </>
      )}
    </div>
  );
}
