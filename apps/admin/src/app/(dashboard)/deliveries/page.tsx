'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, CardContent } from '@sqlm/ui';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { FulfillForm } from '@/components/fulfill-form';

export default function DeliveriesPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['deliveries'],
    queryFn: () => api.pendingDeliveries(),
    refetchInterval: 20_000,
  });
  const selected = data?.find((d) => d.id === selectedId) ?? data?.[0] ?? null;

  return (
    <>
      <PageHeader
        title="Deliveries"
        description="Paid items waiting for staff: manual products, and anything automatic delivery could not complete."
      />
      {flash && <p className="mb-4 rounded-md border border-success/40 bg-success/10 p-2 text-sm">{flash}</p>}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data?.length ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          Nothing waiting — every paid order has been delivered.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="space-y-2">
            {data.map((d) => (
              <Card
                key={d.id}
                onClick={() => setSelectedId(d.id)}
                className={`cursor-pointer ${selected?.id === d.id ? 'border-primary' : 'hover:border-primary/40'}`}
              >
                <CardContent className="flex items-center justify-between p-3">
                  <div className="text-sm">
                    <p className="font-medium" dir="auto">
                      {d.orderItem.productNameSnapshot} × {d.orderItem.quantity}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Order #{d.order?.sequenceNumber} · {d.order?.customer?.firstName ?? 'Customer'}
                      {d.order?.customer?.telegramUsername && ` @${d.order.customer.telegramUsername}`}
                    </p>
                    {d.lastError && <p className="text-xs text-destructive">{d.lastError}</p>}
                  </div>
                  <Badge variant={d.status === 'FAILED' ? 'destructive' : 'warning'}>{d.status.toLowerCase()}</Badge>
                </CardContent>
              </Card>
            ))}
          </div>

          {selected && (
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Deliver order #{selected.order?.sequenceNumber}</p>
                  <Link href={`/orders/${selected.orderId}`} className="text-xs text-primary underline">
                    Open order
                  </Link>
                </div>
                <FulfillForm
                  key={selected.id}
                  delivery={selected}
                  onDone={() => {
                    setFlash(`Delivered order #${selected.order?.sequenceNumber} — the customer was notified.`);
                    setSelectedId(null);
                  }}
                />
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
