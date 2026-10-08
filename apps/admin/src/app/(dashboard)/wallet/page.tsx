'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Badge, Button, Card, CardContent, Input } from '@sqlm/ui';
import { api, ApiError, type WalletTopUp } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { useAuthStore } from '@/store/auth-store';

const TABS = [
  { value: 'PENDING', label: 'Waiting' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
] as const;

const REJECT_REASONS = ['التحويل موصلش', 'المبلغ مش مطابق', 'الإيصال مش واضح'];

export default function WalletTopUpsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['value']>('PENDING');
  const { data, isLoading } = useQuery({
    queryKey: ['wallet-topups', tab],
    queryFn: () => api.walletTopUps(tab),
  });

  return (
    <>
      <PageHeader
        title="Wallet top-ups"
        description="Merchants add balance with a transfer receipt. Check the transfer on your statement, then approve — the balance is credited at once and the merchant is told in Telegram."
      />
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-muted p-1 sm:inline-flex">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm sm:flex-none ${tab === t.value ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data?.length ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          {tab === 'PENDING' ? 'No top-ups waiting.' : 'Nothing here.'}
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.map((t) => (
            <TopUpCard key={t.id} topUp={t} />
          ))}
        </div>
      )}
    </>
  );
}

function TopUpCard({ topUp: t }: { topUp: WalletTopUp }) {
  const queryClient = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const [amount, setAmount] = useState(String(Number(t.amount)));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const proof = useQuery({
    queryKey: ['topup-proof', t.id],
    queryFn: () => api.walletTopUpProof(t.id),
    staleTime: 10 * 60_000,
  });

  const review = useMutation({
    mutationFn: (approve: boolean) =>
      api.reviewTopUp(
        t.id,
        approve ? { approve, amount: Number(amount) } : { approve, reason: reason.trim() },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wallet-topups'] });
      void queryClient.invalidateQueries({ queryKey: ['customer-wallet', t.customer.id] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed'),
  });
  const name = t.customer.fullName || t.customer.firstName || 'Merchant';
  const amountChanged = Number(amount) !== Number(t.amount);

  return (
    <Card>
      <CardContent className="space-y-3 p-4 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-semibold tabular-nums">
              {Number(t.amount).toFixed(2)} {t.currency}
            </p>
            {t.payAmount && (
              <p className="text-xs text-muted-foreground tabular-nums">
                Should transfer {Number(t.payAmount).toFixed(2)} {t.payCurrency}
                {t.paymentMethod && ` via ${t.paymentMethod.name}`}
              </p>
            )}
            <Link
              href={`/customers/${t.customer.id}`}
              className="mt-1 block text-xs hover:underline"
              dir="auto"
            >
              🏪 {name}
              {t.customer.telegramUsername && ` · @${t.customer.telegramUsername}`} · balance{' '}
              {Number(t.customer.walletBalance).toFixed(2)}
            </Link>
            {t.senderReference && (
              <p className="text-xs text-muted-foreground">
                Sent from <span dir="ltr">{t.senderReference}</span>
              </p>
            )}
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {new Date(t.createdAt).toLocaleString()}
          </span>
        </div>

        {proof.data ? (
          proof.data.mimeType.startsWith('image/') ? (
            <a href={proof.data.url} target="_blank" rel="noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element -- presigned receipt URL */}
              <img
                src={proof.data.url}
                alt="Transfer receipt"
                className="max-h-72 w-full rounded-md border object-contain"
              />
            </a>
          ) : (
            <a
              href={proof.data.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary underline"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open receipt (PDF)
            </a>
          )
        ) : (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading receipt…
          </p>
        )}

        {t.status === 'PENDING' ? (
          can('payments.proofs.review') && (
            <div className="space-y-3 border-t pt-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-muted-foreground">
                  Credit
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="mt-1 w-32"
                  />
                </label>
                <Button
                  size="sm"
                  disabled={review.isPending || !(Number(amount) > 0)}
                  onClick={() => review.mutate(true)}
                >
                  ✓ Approve {amountChanged ? `${Number(amount).toFixed(2)}` : ''}
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {REJECT_REASONS.map((r) => (
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
              <div className="flex gap-2">
                <Input
                  dir="auto"
                  value={reason}
                  placeholder="Reason (sent to the merchant)"
                  onChange={(e) => setReason(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={review.isPending || reason.trim().length < 2}
                  onClick={() => review.mutate(false)}
                >
                  Reject
                </Button>
              </div>
            </div>
          )
        ) : (
          <p className="text-xs text-muted-foreground">
            <Badge variant={t.status === 'APPROVED' ? 'success' : 'secondary'} className="mr-1.5">
              {t.status.toLowerCase()}
            </Badge>
            {t.reviewedBy?.name ? `by ${t.reviewedBy.name}` : ''}
            {t.rejectReason ? ` — “${t.rejectReason}”` : ''}
          </p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
