'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input } from '@sqlm/ui';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth-store';

const QUICK_REASONS = ['المبلغ غير صحيح', 'الإيصال غير واضح', 'لم يتم استلام التحويل', 'إيصال مكرر'];
const FAKE_REASON = 'إيصال مزيف أو تحويل غير حقيقي';

/** Shows a proof through a short-lived signed link and, while pending, the approve/reject controls. */
export function ProofReview({
  proofId,
  mimeType,
  pending,
  onDone,
}: {
  proofId: string;
  mimeType: string;
  pending: boolean;
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const [reason, setReason] = useState('');
  const [honest, setHonest] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: view, isLoading, isError } = useQuery({
    queryKey: ['proof-url', proofId],
    queryFn: () => api.proofViewUrl(proofId),
    staleTime: 5 * 60_000,
  });
  // The API's risk read: a reused screenshot, earlier rejections, a brand-new account.
  const { data: detail } = useQuery({ queryKey: ['payment-proof', proofId], queryFn: () => api.paymentProof(proofId) });
  const flags = detail?.risk?.flags ?? [];

  const done = () => {
    setReason('');
    setError(null);
    void queryClient.invalidateQueries({ queryKey: ['payment-proofs'] });
    void queryClient.invalidateQueries({ queryKey: ['order'] });
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
    void queryClient.invalidateQueries({ queryKey: ['stats'] });
    onDone?.();
  };
  const fail = (err: unknown) => setError(err instanceof ApiError ? err.message : 'Action failed');

  const approve = useMutation({ mutationFn: () => api.approveProof(proofId), onSuccess: done, onError: fail });
  const reject = useMutation({
    mutationFn: (cancelOrder: boolean) =>
      api.rejectProof(proofId, reason.trim(), cancelOrder, honest ? false : undefined),
    onSuccess: done,
    onError: fail,
  });
  const rejectAsFake = useMutation({
    mutationFn: async () => {
      await api.rejectProof(proofId, FAKE_REASON, true, false);
      if (detail?.customerId) await api.banCustomer(detail.customerId, FAKE_REASON);
    },
    onSuccess: done,
    onError: fail,
  });

  return (
    <div className="space-y-3">
      {detail?.senderReference && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm">
          Customer says they paid from:{' '}
          <span className="font-mono font-semibold" dir="ltr">
            {detail.senderReference}
          </span>
        </p>
      )}
      {flags.length > 0 ? (
        <ul className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" dir="rtl">
          {flags.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      ) : (
        detail?.risk && <p className="text-xs text-muted-foreground">✅ No risk signals on this customer.</p>
      )}

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading proof…</p>
      ) : isError || !view ? (
        <p className="text-xs text-destructive">Could not load the proof file.</p>
      ) : mimeType === 'application/pdf' ? (
        <a href={view.url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
          Open PDF proof
        </a>
      ) : (
        <a href={view.url} target="_blank" rel="noreferrer" title="Open full size">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed, time-limited storage URL */}
          <img src={view.url} alt="Payment proof" className="max-h-96 rounded border object-contain" />
        </a>
      )}

      {pending && can('payments.proofs.review') && (
        <>
          <div className="flex flex-wrap gap-1">
            {QUICK_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className="rounded-full border px-2 py-0.5 text-xs hover:bg-accent"
                dir="rtl"
              >
                {r}
              </button>
            ))}
          </div>
          <Input
            dir="auto"
            placeholder="Rejection reason (sent to the customer)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={honest}
              onChange={(e) => setHonest(e.target.checked)}
            />
            <span>
              Honest mistake — don&apos;t count this rejection against the customer. (By default a second
              suspicious rejection in a day, or any rejection that cancels the order, suspends them.)
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={approve.isPending || reject.isPending} onClick={() => approve.mutate()}>
              ✓ Approve payment
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!reason.trim() || reject.isPending}
              onClick={() => reject.mutate(false)}
            >
              Reject — customer can re-upload
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={!reason.trim() || reject.isPending}
              onClick={() => window.confirm('Reject and cancel this order?') && reject.mutate(true)}
            >
              Reject &amp; cancel order
            </Button>
            {can('customers.ban') && (
              <Button
                size="sm"
                variant="destructive"
                disabled={rejectAsFake.isPending || reject.isPending || !detail}
                onClick={() =>
                  window.confirm('Fake receipt: reject it, cancel the order and BAN this customer from the store?') &&
                  rejectAsFake.mutate()
                }
              >
                🚫 Fake — reject &amp; ban
              </Button>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </>
      )}
    </div>
  );
}
