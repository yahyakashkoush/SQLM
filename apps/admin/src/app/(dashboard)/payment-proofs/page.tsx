'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, CardContent } from '@sqlm/ui';
import { api, type PaymentProof } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { ProofReview } from '@/components/proof-review';

export default function PaymentProofsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['payment-proofs'],
    queryFn: () => api.paymentProofs(),
    refetchInterval: 20_000,
  });
  const selected = data?.find((p) => p.id === selectedId) ?? data?.[0] ?? null;

  return (
    <>
      <PageHeader
        title="Payment Review"
        description="Approve to start delivery; reject with a reason and the customer is told on Telegram."
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data?.length ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          No payment proofs waiting for review.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="space-y-2">
            {data.map((proof: PaymentProof & { order?: { paymentMethod?: { name: string } | null } }) => (
              <Card
                key={proof.id}
                onClick={() => setSelectedId(proof.id)}
                className={`cursor-pointer ${selected?.id === proof.id ? 'border-primary' : 'hover:border-primary/40'}`}
              >
                <CardContent className="flex items-center justify-between p-3 text-sm">
                  <div>
                    <p className="font-medium">
                      Order #{proof.order?.sequenceNumber} · {proof.order?.total} {proof.order?.currency}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {proof.customer?.firstName ?? 'Customer'}
                      {proof.customer?.telegramUsername && ` (@${proof.customer.telegramUsername})`}
                      {proof.order?.paymentMethod && ` · ${proof.order.paymentMethod.name}`}
                    </p>
                    <p className="text-xs text-muted-foreground">{new Date(proof.uploadedAt).toLocaleString()}</p>
                  </div>
                  <Badge variant="warning">pending</Badge>
                </CardContent>
              </Card>
            ))}
          </div>

          {selected && (
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    Order #{selected.order?.sequenceNumber} — {selected.order?.total} {selected.order?.currency}
                  </p>
                  <Link href={`/orders/${selected.orderId}`} className="text-xs text-primary underline">
                    Open order
                  </Link>
                </div>
                <ProofReview
                  key={selected.id}
                  proofId={selected.id}
                  mimeType={selected.mimeType}
                  pending
                  onDone={() => setSelectedId(null)}
                />
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
