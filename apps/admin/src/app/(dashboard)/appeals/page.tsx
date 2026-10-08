'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, Input } from '@sqlm/ui';
import { api, ApiError, type Appeal } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { useAuthStore } from '@/store/auth-store';

const TABS = [
  { value: 'PENDING', label: 'Waiting' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'REJECTED', label: 'Rejected' },
] as const;

export default function AppealsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['value']>('PENDING');
  const { data, isLoading } = useQuery({ queryKey: ['appeals', tab], queryFn: () => api.appeals(tab) });

  return (
    <>
      <PageHeader
        title="Appeals"
        description="Suspended or banned customers asking to be let back in. Accepting lifts the suspension or ban and clears their strikes."
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
          {tab === 'PENDING' ? 'No appeals waiting. 🎉' : 'Nothing here.'}
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.map((appeal) => (
            <AppealCard key={appeal.id} appeal={appeal} />
          ))}
        </div>
      )}
    </>
  );
}

function AppealCard({ appeal }: { appeal: Appeal }) {
  const queryClient = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const [response, setResponse] = useState('');
  const [error, setError] = useState<string | null>(null);
  const review = useMutation({
    mutationFn: (accept: boolean) => api.reviewAppeal(appeal.id, accept, response.trim() || undefined),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['appeals'] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed'),
  });
  const c = appeal.customer;
  const restriction =
    c.status === 'BANNED'
      ? `🚫 Banned — ${c.banReason ?? 'no reason'}`
      : c.suspendedUntil && new Date(c.suspendedUntil) > new Date()
        ? `⏸️ Suspended until ${new Date(c.suspendedUntil).toLocaleString()} — ${c.suspendReason ?? ''}`
        : '✔️ Not restricted any more';

  return (
    <Card>
      <CardContent className="space-y-3 p-4 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <Link href={`/customers/${c.id}`} className="font-medium hover:underline" dir="auto">
            {[c.firstName, c.lastName].filter(Boolean).join(' ') || 'Customer'}
            {c.telegramUsername && <span className="ml-1 font-normal text-muted-foreground">@{c.telegramUsername}</span>}
          </Link>
          <span className="text-xs text-muted-foreground">{new Date(appeal.createdAt).toLocaleString()}</span>
        </div>
        <p className="text-xs text-muted-foreground" dir="auto">
          {restriction}
        </p>
        <p className="whitespace-pre-wrap rounded-md bg-muted p-3" dir="auto">
          {appeal.message}
        </p>
        {appeal.status === 'PENDING' ? (
          can('customers.ban') && (
            <>
              <Input
                dir="auto"
                value={response}
                placeholder="Reply to the customer (optional)"
                onChange={(e) => setResponse(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={review.isPending} onClick={() => review.mutate(true)}>
                  ✓ Accept & restore
                </Button>
                <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => review.mutate(false)}>
                  Reject
                </Button>
              </div>
            </>
          )
        ) : (
          <p className="text-xs text-muted-foreground">
            <Badge variant={appeal.status === 'ACCEPTED' ? 'success' : 'secondary'} className="mr-1.5">
              {appeal.status.toLowerCase()}
            </Badge>
            {appeal.reviewedBy?.name ? `by ${appeal.reviewedBy.name}` : ''}
            {appeal.response ? ` — “${appeal.response}”` : ''}
          </p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
