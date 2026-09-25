'use client';

import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ORDER_STATUSES } from '@sqlm/shared';
import { Badge, Button, Card, CardContent, Input, Separator } from '@sqlm/ui';
import { api, ApiError } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: order, isLoading } = useQuery({ queryKey: ['order', id], queryFn: () => api.order(id) });
  const { data: deliveries } = useQuery({
    queryKey: ['deliveries', id],
    queryFn: () => api.orderDeliveries(id),
  });

  const transition = useMutation({
    mutationFn: (toStatus: string) => api.transitionOrder(id, toStatus, note || undefined),
    onSuccess: () => {
      setNote('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['order', id] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Transition failed'),
  });

  const retryDelivery = useMutation({
    mutationFn: () => api.retryDelivery(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['deliveries', id] }),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading order…</p>;
  if (!order) return <p className="text-sm text-muted-foreground">Order not found.</p>;

  return (
    <>
      <PageHeader
        title={`Order #${order.sequenceNumber}`}
        description={new Date(order.createdAt).toLocaleString()}
        action={<Badge variant="secondary">{order.status}</Badge>}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <p className="mb-2 text-sm font-medium">Items</p>
            {order.items.map((item) => (
              <div key={item.id} className="flex justify-between py-1 text-sm">
                <span>
                  {item.productNameSnapshot} × {item.quantity}
                </span>
                <span>{item.unitPrice}</span>
              </div>
            ))}
            <Separator className="my-2" />
            <div className="flex justify-between text-sm font-semibold">
              <span>Total</span>
              <span>
                {order.total} {order.currency}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">Fulfillment</p>
              <Button
                size="sm"
                variant="outline"
                disabled={retryDelivery.isPending}
                onClick={() => retryDelivery.mutate()}
              >
                Re-run delivery
              </Button>
            </div>
            {!deliveries?.length ? (
              <p className="text-sm text-muted-foreground">No delivery records yet.</p>
            ) : (
              deliveries.map((d) => (
                <div key={d.id} className="border-t py-2 text-sm first:border-t-0">
                  <div className="flex justify-between">
                    <span>{d.orderItem.productNameSnapshot}</span>
                    <Badge variant={d.status === 'DELIVERED' ? 'success' : 'warning'}>
                      {d.method} · {d.status}
                    </Badge>
                  </div>
                  {d.lastError && <p className="text-xs text-destructive">{d.lastError}</p>}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardContent className="p-4">
          <p className="mb-2 text-sm font-medium">Change status</p>
          <p className="mb-3 text-xs text-muted-foreground">
            Only transitions the order state machine allows will succeed — invalid ones are rejected
            by the server.
          </p>
          <Input
            placeholder="Note (optional, recorded in the order's audit trail)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mb-3"
          />
          <div className="flex flex-wrap gap-1.5">
            {ORDER_STATUSES.filter((s) => s !== order.status).map((s) => (
              <Button
                key={s}
                size="sm"
                variant="outline"
                disabled={transition.isPending}
                onClick={() => transition.mutate(s)}
              >
                {s.replace(/_/g, ' ').toLowerCase()}
              </Button>
            ))}
          </div>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </>
  );
}
