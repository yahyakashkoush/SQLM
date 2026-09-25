'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, Input } from '@sqlm/ui';
import { api, ApiError, type PaymentProof } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';

export default function PaymentProofsPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<PaymentProof | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['payment-proofs'],
    queryFn: () => api.paymentProofs(),
    refetchInterval: 30_000,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['payment-proofs'] });
    void queryClient.invalidateQueries({ queryKey: ['stats'] });
    setSelected(null);
    setProofUrl(null);
    setReason('');
  };

  const approve = useMutation({
    mutationFn: (id: string) => api.approveProof(id),
    onSuccess: refresh,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Approval failed'),
  });

  const reject = useMutation({
    mutationFn: ({ id, cancelOrder }: { id: string; cancelOrder: boolean }) =>
      api.rejectProof(id, reason, cancelOrder),
    onSuccess: refresh,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Rejection failed'),
  });

  const openProof = async (proof: PaymentProof) => {
    setSelected(proof);
    setError(null);
    try {
      const { url } = await api.proofViewUrl(proof.id);
      setProofUrl(url);
    } catch {
      setProofUrl(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Payment Review"
        description="Proofs are never auto-approved — each one is reviewed here."
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data?.length ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          No payment proofs waiting for review.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            {data.map((proof) => (
              <Card
                key={proof.id}
                className={selected?.id === proof.id ? 'border-primary' : undefined}
              >
                <CardContent className="flex items-center justify-between p-3">
                  <div className="text-sm">
                    <p className="font-medium">
                      Order #{proof.order?.sequenceNumber ?? proof.orderId.slice(0, 8)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {proof.order?.total} {proof.order?.currency} ·{' '}
                      {new Date(proof.uploadedAt).toLocaleString()}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => void openProof(proof)}>
                    Review
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          {selected && (
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    Order #{selected.order?.sequenceNumber ?? selected.orderId.slice(0, 8)}
                  </p>
                  <Badge variant="warning">{selected.status}</Badge>
                </div>

                {proofUrl ? (
                  selected.mimeType === 'application/pdf' ? (
                    <a
                      href={proofUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-primary underline"
                    >
                      Open PDF proof
                    </a>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- presigned, time-limited storage URL
                    <img src={proofUrl} alt="Payment proof" className="max-h-80 rounded border" />
                  )
                ) : (
                  <p className="text-xs text-muted-foreground">Generating secure view link…</p>
                )}

                <Input
                  placeholder="Rejection reason (required to reject)"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={approve.isPending}
                    onClick={() => approve.mutate(selected.id)}
                  >
                    Approve &amp; fulfill
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!reason || reject.isPending}
                    onClick={() => reject.mutate({ id: selected.id, cancelOrder: false })}
                  >
                    Reject — let them retry
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={!reason || reject.isPending}
                    onClick={() => reject.mutate({ id: selected.id, cancelOrder: true })}
                  >
                    Reject &amp; cancel order
                  </Button>
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
