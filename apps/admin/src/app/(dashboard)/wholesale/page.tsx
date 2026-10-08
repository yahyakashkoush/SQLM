'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, Input } from '@sqlm/ui';
import { api, ApiError, type WholesaleApplication } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { useAuthStore } from '@/store/auth-store';

const TABS = [
  { value: 'PENDING', label: 'Waiting' },
  { value: 'APPROVED', label: 'Members' },
  { value: 'REJECTED', label: 'Rejected' },
] as const;

export default function WholesalePage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['value']>('PENDING');
  const { data, isLoading } = useQuery({ queryKey: ['wholesale', tab], queryFn: () => api.wholesaleApplications(tab) });

  return (
    <>
      <PageHeader
        title="Wholesale"
        description="Resellers who applied for wholesale prices. Approved members see the bundles you mark “wholesale only” on each product. Edit the terms under Settings → Wholesale."
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
          {tab === 'PENDING' ? 'No applications waiting.' : 'Nothing here.'}
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.map((a) => (
            <ApplicationCard key={a.id} application={a} />
          ))}
        </div>
      )}
    </>
  );
}

function ApplicationCard({ application: a }: { application: WholesaleApplication }) {
  const queryClient = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const review = useMutation({
    mutationFn: (approve: boolean) => api.reviewWholesale(a.id, approve, note.trim() || undefined),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['wholesale'] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed'),
  });

  return (
    <Card>
      <CardContent className="space-y-3 p-4 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium" dir="auto">
              🏪 {a.businessName}
            </p>
            <Link href={`/customers/${a.customer.id}`} className="text-xs text-muted-foreground hover:underline" dir="auto">
              {[a.customer.firstName, a.customer.lastName].filter(Boolean).join(' ') || 'Customer'}
              {a.customer.telegramUsername && ` · @${a.customer.telegramUsername}`}
            </Link>
          </div>
          <span className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleDateString()}</span>
        </div>
        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Phone</dt>
          <dd>
            <a href={`tel:${a.contactPhone}`} className="text-primary underline" dir="ltr">
              {a.contactPhone}
            </a>
          </dd>
          {a.monthlyVolume && (
            <>
              <dt className="text-muted-foreground">Volume</dt>
              <dd dir="auto">{a.monthlyVolume}</dd>
            </>
          )}
          {a.notes && (
            <>
              <dt className="text-muted-foreground">Notes</dt>
              <dd className="whitespace-pre-wrap" dir="auto">
                {a.notes}
              </dd>
            </>
          )}
        </dl>
        {a.status === 'PENDING' ? (
          can('customers.write') && (
            <>
              <Input dir="auto" value={note} placeholder="Note to the applicant (optional)" onChange={(e) => setNote(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={review.isPending} onClick={() => review.mutate(true)}>
                  ✓ Approve
                </Button>
                <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => review.mutate(false)}>
                  Reject
                </Button>
              </div>
            </>
          )
        ) : (
          <p className="text-xs text-muted-foreground">
            <Badge variant={a.status === 'APPROVED' ? 'success' : 'secondary'} className="mr-1.5">
              {a.status.toLowerCase()}
            </Badge>
            {a.reviewedBy?.name ? `by ${a.reviewedBy.name}` : ''}
            {a.staffNote ? ` — “${a.staffNote}”` : ''}
          </p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
