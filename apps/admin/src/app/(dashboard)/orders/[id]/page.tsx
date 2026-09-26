'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ORDER_STATUS_LABELS_AR, ORDER_TRANSITIONS, type OrderStatus } from '@sqlm/shared';
import { Badge, Button, Card, CardContent, Input, Separator } from '@sqlm/ui';
import { api, ApiError, type PendingDelivery } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { FulfillForm } from '@/components/fulfill-form';
import { ProofReview } from '@/components/proof-review';
import { useAuthStore } from '@/store/auth-store';
import { statusVariant } from '@/lib/order-status';

const ACTION_LABELS: Record<string, string> = {
  PENDING_PAYMENT: 'Back to awaiting payment',
  PAYMENT_SUBMITTED: 'Mark payment submitted',
  PAYMENT_REVIEW: 'Send to payment review',
  PAID: 'Mark as paid (starts delivery)',
  PROCESSING: 'Start processing',
  READY_FOR_DELIVERY: 'Mark ready for delivery',
  DELIVERED: 'Mark delivered',
  COMPLETED: 'Complete order',
  CANCELLED: 'Cancel order',
  REFUNDED: 'Refund order',
  DISPUTED: 'Mark disputed',
};
const DESTRUCTIVE = new Set(['CANCELLED', 'REFUNDED', 'DISPUTED']);

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: order, isLoading } = useQuery({
    queryKey: ['order', id],
    queryFn: () => api.order(id),
    refetchInterval: 15_000,
  });
  const { data: deliveries } = useQuery({
    queryKey: ['deliveries', id],
    queryFn: () => api.orderDeliveries(id),
    refetchInterval: 15_000,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['order', id] });
    void queryClient.invalidateQueries({ queryKey: ['deliveries'] });
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
    void queryClient.invalidateQueries({ queryKey: ['stats'] });
  };

  const transition = useMutation({
    mutationFn: (toStatus: string) => api.transitionOrder(id, toStatus, note || undefined),
    onSuccess: () => {
      setNote('');
      setError(null);
      refresh();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Action failed'),
  });

  const startDelivery = useMutation({
    mutationFn: () => api.retryDelivery(id),
    onSuccess: () => setTimeout(refresh, 1500),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading order…</p>;
  if (!order) return <p className="text-sm text-muted-foreground">Order not found.</p>;

  const allowed = ORDER_TRANSITIONS[order.status as OrderStatus] ?? [];
  const pendingProof = order.paymentProofs.find((p) => p.status === 'PENDING');
  const awaitingDelivery = ['PAID', 'PROCESSING', 'READY_FOR_DELIVERY'].includes(order.status);

  return (
    <>
      <PageHeader
        title={`Order #${order.sequenceNumber}`}
        description={`Placed ${new Date(order.createdAt).toLocaleString()}`}
        action={
          <Badge variant={statusVariant(order.status)} className="text-sm">
            {order.status.replace(/_/g, ' ').toLowerCase()} · {ORDER_STATUS_LABELS_AR[order.status as OrderStatus]}
          </Badge>
        }
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardContent className="p-4">
              <p className="mb-2 text-sm font-medium">Items</p>
              {order.items.map((item) => (
                <div key={item.id} className="flex items-center gap-3 py-1.5 text-sm">
                  {item.product.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- arbitrary storage hosts
                    <img src={item.product.images[0]} alt="" className="h-9 w-9 rounded object-cover" />
                  ) : (
                    <div className="h-9 w-9 rounded bg-muted" />
                  )}
                  <span className="flex-1" dir="auto">
                    {item.productNameSnapshot} × {item.quantity}
                  </span>
                  <span>
                    {(Number(item.unitPrice) * item.quantity).toFixed(2)} {order.currency}
                  </span>
                </div>
              ))}
              <Separator className="my-2" />
              <div className="flex justify-between text-sm font-semibold">
                <span>Total</span>
                <span>
                  {order.total} {order.currency}
                </span>
              </div>
              {order.cancelReason && (
                <p className="mt-2 text-xs text-destructive">Cancel reason: {order.cancelReason}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-1 p-4 text-sm">
              <p className="mb-1 font-medium">Customer</p>
              <p dir="auto">
                {[order.customer.firstName, order.customer.lastName].filter(Boolean).join(' ') || '—'}
                {order.customer.status !== 'ACTIVE' && (
                  <Badge variant="destructive" className="ml-2">
                    {order.customer.status}
                  </Badge>
                )}
              </p>
              {order.customer.telegramUsername && (
                <a
                  href={`https://t.me/${order.customer.telegramUsername}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                >
                  @{order.customer.telegramUsername}
                </a>
              )}
              <p className="text-xs text-muted-foreground">Telegram ID: {order.customer.telegramId}</p>
              <Link href={`/customers/${order.customer.id}`} className="text-xs text-primary underline">
                Customer history →
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              <p className="text-sm font-medium">Payment</p>
              {order.paymentMethod ? (
                <div className="rounded bg-muted p-2 text-sm">
                  <p className="font-medium">{order.paymentMethod.name}</p>
                  {order.paymentMethod.accountNumber && (
                    <p className="text-xs text-muted-foreground">{order.paymentMethod.accountNumber}</p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No payment method recorded.</p>
              )}
              {order.paidAt && <p className="text-xs text-muted-foreground">Paid {new Date(order.paidAt).toLocaleString()}</p>}

              {order.paymentProofs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {order.status === 'PENDING_PAYMENT'
                    ? 'Waiting for the customer to upload a payment proof.'
                    : 'No payment proofs.'}
                </p>
              ) : (
                order.paymentProofs.map((proof) => (
                  <div key={proof.id} className="space-y-2 border-t pt-3">
                    <div className="flex items-center justify-between text-xs">
                      <span>Uploaded {new Date(proof.uploadedAt).toLocaleString()}</span>
                      <Badge
                        variant={
                          proof.status === 'APPROVED' ? 'success' : proof.status === 'REJECTED' ? 'destructive' : 'warning'
                        }
                      >
                        {proof.status.toLowerCase()}
                      </Badge>
                    </div>
                    {proof.rejectionReason && (
                      <p className="text-xs text-destructive" dir="auto">
                        Reason: {proof.rejectionReason}
                      </p>
                    )}
                    {proof.reviewedBy && (
                      <p className="text-xs text-muted-foreground">Reviewed by {proof.reviewedBy.name}</p>
                    )}
                    <ProofReview
                      proofId={proof.id}
                      mimeType={proof.mimeType}
                      pending={proof.id === pendingProof?.id}
                      onDone={refresh}
                    />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Delivery</p>
                {can('delivery.fulfill') && awaitingDelivery && (
                  <Button size="sm" variant="outline" disabled={startDelivery.isPending} onClick={() => startDelivery.mutate()}>
                    {deliveries?.length ? 'Re-run automatic delivery' : 'Start delivery'}
                  </Button>
                )}
              </div>
              {!deliveries?.length ? (
                <p className="text-sm text-muted-foreground">
                  {awaitingDelivery
                    ? 'Delivery records are being prepared — press “Start delivery” if nothing appears.'
                    : 'Delivery starts once the payment is approved.'}
                </p>
              ) : (
                deliveries.map((d) => <DeliveryRow key={d.id} delivery={d} onChanged={refresh} />)
              )}
            </CardContent>
          </Card>

          {can('orders.transition') && (
            <Card>
              <CardContent className="space-y-3 p-4">
                <p className="text-sm font-medium">Order actions</p>
                {!allowed.length ? (
                  <p className="text-sm text-muted-foreground">No further actions — this order is closed.</p>
                ) : (
                  <>
                    <Input
                      dir="auto"
                      placeholder="Note / reason (optional — shown to the customer on cancel/refund)"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {allowed.map((s) => (
                        <Button
                          key={s}
                          size="sm"
                          variant={DESTRUCTIVE.has(s) ? 'destructive' : s === 'PAID' || s === 'COMPLETED' ? 'default' : 'outline'}
                          disabled={transition.isPending}
                          onClick={() => {
                            if (DESTRUCTIVE.has(s) && !window.confirm(`${ACTION_LABELS[s]}?`)) return;
                            transition.mutate(s);
                          }}
                        >
                          {ACTION_LABELS[s] ?? s}
                        </Button>
                      ))}
                    </div>
                  </>
                )}
                {error && <p className="text-sm text-destructive">{error}</p>}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-4">
              <p className="mb-2 text-sm font-medium">Timeline</p>
              <ol className="space-y-2">
                {order.events.map((e) => (
                  <li key={e.id} className="border-l-2 pl-3 text-xs">
                    <p className="font-medium">
                      {e.type === 'STATUS_CHANGED'
                        ? `${e.fromStatus?.replace(/_/g, ' ').toLowerCase() ?? '—'} → ${e.toStatus?.replace(/_/g, ' ').toLowerCase()}`
                        : e.type.replace(/_/g, ' ').toLowerCase()}
                    </p>
                    <p className="text-muted-foreground">
                      {new Date(e.createdAt).toLocaleString()} ·{' '}
                      {e.actorStaff?.name ?? e.actorType.toLowerCase()}
                    </p>
                    {e.note && (
                      <p className="text-muted-foreground" dir="auto">
                        {e.note}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function DeliveryRow({ delivery, onChanged }: { delivery: PendingDelivery; onChanged: () => void }) {
  const can = useAuthStore((s) => s.can);
  const [mode, setMode] = useState<'idle' | 'fulfill' | 'replace'>(
    delivery.status !== 'DELIVERED' && can('delivery.fulfill') ? 'fulfill' : 'idle',
  );
  const [content, setContent] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const reveal = useMutation({
    mutationFn: () => api.deliveryContent(delivery.id),
    onSuccess: (r) => setContent(r.content ?? '(empty)'),
  });
  const resend = useMutation({
    mutationFn: () => api.resendDelivery(delivery.id),
    onSuccess: () => setInfo('Sent to the customer again.'),
  });

  return (
    <div className="space-y-2 border-t pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span dir="auto" className="font-medium">
          {delivery.orderItem.productNameSnapshot} × {delivery.orderItem.quantity}
        </span>
        <Badge variant={delivery.status === 'DELIVERED' ? 'success' : delivery.status === 'FAILED' ? 'destructive' : 'warning'}>
          {delivery.method.toLowerCase()} · {delivery.status.toLowerCase()}
        </Badge>
      </div>
      {delivery.lastError && <p className="text-xs text-destructive">{delivery.lastError}</p>}
      {delivery.deliveredAt && (
        <p className="text-xs text-muted-foreground">
          Delivered {new Date(delivery.deliveredAt).toLocaleString()}
          {delivery.deliveredByStaff ? ` by ${delivery.deliveredByStaff.name}` : ' automatically'}
        </p>
      )}

      {delivery.status === 'DELIVERED' && can('delivery.fulfill') && mode === 'idle' && (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={() => (content ? setContent(null) : reveal.mutate())}>
            {content ? 'Hide details' : 'View details'}
          </Button>
          <Button size="sm" variant="outline" disabled={resend.isPending} onClick={() => resend.mutate()}>
            Resend to customer
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMode('replace')}>
            Replace details
          </Button>
        </div>
      )}
      {content && (
        <pre dir="auto" className="whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs">
          {content}
        </pre>
      )}
      {info && <p className="text-xs text-success">{info}</p>}

      {mode !== 'idle' && (
        <FulfillForm
          delivery={delivery}
          mode={mode}
          onDone={() => {
            setMode('idle');
            setContent(null);
            onChanged();
          }}
          onCancel={delivery.status === 'DELIVERED' ? () => setMode('idle') : undefined}
        />
      )}
    </div>
  );
}
