'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, Input } from '@sqlm/ui';
import { api, ApiError, type PendingDelivery } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';

export default function DeliveriesPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<PendingDelivery | null>(null);
  const [content, setContent] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['deliveries'],
    queryFn: () => api.pendingDeliveries(),
    refetchInterval: 30_000,
  });

  const fulfill = useMutation({
    mutationFn: (id: string) => api.fulfillDelivery(id, content, note || undefined),
    onSuccess: () => {
      setSelected(null);
      setContent('');
      setNote('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Fulfillment failed'),
  });

  return (
    <>
      <PageHeader
        title="Deliveries"
        description="Items that need a human: manual products, and anything automatic delivery could not complete."
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data?.length ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          Nothing waiting — every paid order has been delivered.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            {data.map((d) => (
              <Card key={d.id} className={selected?.id === d.id ? 'border-primary' : undefined}>
                <CardContent className="flex items-center justify-between p-3">
                  <div className="text-sm">
                    <p className="font-medium">{d.orderItem.productNameSnapshot}</p>
                    <p className="text-xs text-muted-foreground">
                      Order #{d.order?.sequenceNumber ?? d.orderId.slice(0, 8)} · qty{' '}
                      {d.orderItem.quantity}
                      {d.attempts > 0 && ` · ${d.attempts} attempt(s)`}
                    </p>
                    {d.lastError && <p className="text-xs text-destructive">{d.lastError}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={d.status === 'FAILED' ? 'destructive' : 'warning'}>
                      {d.status}
                    </Badge>
                    <Button size="sm" variant="outline" onClick={() => setSelected(d)}>
                      Fulfill
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {selected && (
            <Card>
              <CardContent className="space-y-3 p-4">
                <p className="text-sm font-medium">
                  Deliver: {selected.orderItem.productNameSnapshot}
                </p>
                <p className="text-xs text-muted-foreground">
                  What you enter here is encrypted at rest and shown to the customer in their order.
                </p>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={6}
                  placeholder="Credentials, activation code, or instructions…"
                  className="w-full rounded-md border bg-transparent p-2 text-sm"
                />
                <Input
                  placeholder="Internal note (optional)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <Button
                  size="sm"
                  disabled={!content || fulfill.isPending}
                  onClick={() => fulfill.mutate(selected.id)}
                >
                  Mark delivered
                </Button>
                {error && <p className="text-sm text-destructive">{error}</p>}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
