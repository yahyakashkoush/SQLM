'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { Badge, Button, Card, CardContent } from '@sqlm/ui';
import { api, type CryptoDeposit, type CryptoWatch } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data-table';
import { useAuthStore } from '@/store/auth-store';

const WATCH_VARIANTS: Record<CryptoWatch['status'], 'success' | 'secondary' | 'destructive'> = {
  WAITING: 'secondary',
  MATCHED: 'success',
  EXPIRED: 'destructive',
  CANCELLED: 'destructive',
};

function formatWhen(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

export default function CryptoPaymentsPage() {
  const queryClient = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const [tab, setTab] = useState<'watches' | 'deposits'>('watches');

  const providers = useQuery({
    queryKey: ['crypto-providers'],
    queryFn: () => api.cryptoProviders(),
  });

  const watches = useQuery({
    queryKey: ['crypto-watches'],
    queryFn: () => api.cryptoWatches(),
    refetchInterval: 15_000,
  });

  const deposits = useQuery({
    queryKey: ['crypto-deposits'],
    queryFn: () => api.cryptoDeposits(),
    refetchInterval: 15_000,
  });

  const pollNow = useMutation({
    mutationFn: () => api.cryptoPollNow(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['crypto-watches'] });
      void queryClient.invalidateQueries({ queryKey: ['crypto-deposits'] });
    },
  });

  const anyConfigured = providers.data?.some((p) => p.configured) ?? false;

  return (
    <>
      <PageHeader
        title="Crypto Payments"
        description="Orders waiting on a deposit, and every deposit the poller has seen."
        action={
          can('payments.proofs.review') && (
            <Button size="sm" disabled={pollNow.isPending} onClick={() => pollNow.mutate()}>
              <RefreshCw className={`h-4 w-4 ${pollNow.isPending ? 'animate-spin' : ''}`} />
              {pollNow.isPending ? 'Checking…' : 'Check now'}
            </Button>
          )
        }
      />

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-3 p-4">
          <p className="text-sm font-medium">Exchange connections</p>
          <div className="flex flex-wrap gap-2">
            {providers.data?.map((p) => (
              <Badge key={p.provider} variant={p.configured ? 'success' : 'secondary'}>
                {p.configured ? <CheckCircle2 className="h-3 w-3" /> : null}
                {p.provider} — {p.configured ? 'connected' : 'no API key'}
              </Badge>
            ))}
          </div>
          {!anyConfigured && (
            <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div className="space-y-1">
                <p className="font-medium">No exchange is connected, so nothing settles automatically.</p>
                <p className="text-muted-foreground">
                  Set <code>BINANCE_API_KEY</code>/<code>BINANCE_API_SECRET</code> or{' '}
                  <code>BYBIT_API_KEY</code>/<code>BYBIT_API_SECRET</code> in the server environment
                  and restart the API. Read-only keys are enough — never give a key withdrawal
                  permission.
                </p>
              </div>
            </div>
          )}
          {pollNow.data && (
            <p className="text-xs text-muted-foreground">
              Last check: {pollNow.data.ingested} new deposit(s), {pollNow.data.settled} settled,{' '}
              {pollNow.data.expired} expired
              {pollNow.data.errors.length > 0 && ` — ${pollNow.data.errors.join('; ')}`}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="mb-4 flex gap-2">
        <Button size="sm" variant={tab === 'watches' ? 'default' : 'outline'} onClick={() => setTab('watches')}>
          Awaiting payment
        </Button>
        <Button size="sm" variant={tab === 'deposits' ? 'default' : 'outline'} onClick={() => setTab('deposits')}>
          Deposits seen
        </Button>
      </div>

      {tab === 'watches' ? (
        <DataTable<CryptoWatch>
          rows={watches.data}
          isLoading={watches.isLoading}
          error={watches.error}
          empty="No crypto payments have been opened yet."
          columns={[
            { header: 'Order', cell: (r) => `#${r.orderNumber}` },
            {
              header: 'Expected amount',
              cell: (r) => (
                <span dir="ltr" className="font-mono text-sm font-semibold">
                  {r.expectedAmount} {r.asset}
                </span>
              ),
            },
            { header: 'Network', cell: (r) => `${r.provider} · ${r.network}` },
            { header: 'Order total', cell: (r) => r.orderTotal },
            { header: 'Status', cell: (r) => <Badge variant={WATCH_VARIANTS[r.status]}>{r.status.toLowerCase()}</Badge> },
            { header: 'Expires', cell: (r) => formatWhen(r.expiresAt) },
            { header: 'Matched', cell: (r) => formatWhen(r.matchedAt) },
          ]}
        />
      ) : (
        <DataTable<CryptoDeposit>
          rows={deposits.data}
          isLoading={deposits.isLoading}
          error={deposits.error}
          empty="No deposits have been seen yet."
          columns={[
            {
              header: 'Amount',
              cell: (r) => (
                <span dir="ltr" className="font-mono text-sm font-semibold">
                  {r.amount} {r.asset}
                </span>
              ),
            },
            { header: 'Network', cell: (r) => `${r.provider} · ${r.network}` },
            {
              header: 'Transaction',
              cell: (r) => (
                <span dir="ltr" className="block max-w-[14rem] truncate font-mono text-xs text-muted-foreground">
                  {r.txId}
                </span>
              ),
            },
            { header: 'Seen', cell: (r) => formatWhen(r.seenAt) },
            {
              header: 'Applied to',
              // An uncredited deposit is the one support has to act on: it
              // is real money that matched no order, usually a wrong amount.
              cell: (r) =>
                r.orderNumber ? (
                  <Badge variant="success">#{r.orderNumber}</Badge>
                ) : (
                  <Badge variant="secondary">unmatched</Badge>
                ),
            },
          ]}
        />
      )}
    </>
  );
}
