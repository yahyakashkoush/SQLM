'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Input } from '@sqlm/ui';
import { CUSTOMER_SEGMENTS, CUSTOMER_SEGMENT_LABELS, type CustomerSegment } from '@sqlm/shared';
import { api, type AdminCustomer } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data-table';

export default function CustomersPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [segment, setSegment] = useState<CustomerSegment | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const segments = useQuery({ queryKey: ['customer-segments'], queryFn: () => api.customerSegments() });
  const { data, isLoading, error } = useQuery({
    queryKey: ['customers', debounced, segment],
    queryFn: () => {
      const qs = new URLSearchParams({ pageSize: '50' });
      if (debounced) qs.set('search', debounced);
      if (segment) qs.set('segment', segment);
      return api.customers(`?${qs.toString()}`);
    },
  });

  return (
    <>
      <PageHeader
        title="Customers"
        description="Everyone who has opened the bot or Mini App. Customers become verified (★) automatically after their first paid order."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search by name or Telegram username…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Button size="sm" variant={segment === null ? 'default' : 'outline'} onClick={() => setSegment(null)}>
          All
        </Button>
        {CUSTOMER_SEGMENTS.filter((s) => s !== 'ALL').map((s) => (
          <Button
            key={s}
            size="sm"
            variant={segment === s ? 'default' : 'outline'}
            title={CUSTOMER_SEGMENT_LABELS[s].description}
            onClick={() => setSegment(s)}
          >
            {CUSTOMER_SEGMENT_LABELS[s].label}
            {segments.data && (
              <span className="ml-1 opacity-70">({segments.data.find((row) => row.segment === s)?.count ?? 0})</span>
            )}
          </Button>
        ))}
      </div>

      <DataTable<AdminCustomer>
        rows={data?.items}
        isLoading={isLoading}
        error={error}
        empty="No customers found."
        onRowClick={(row) => router.push(`/customers/${row.id}`)}
        columns={[
          {
            header: 'Name',
            cell: (r) => (
              <span className="flex items-center gap-2" dir="auto">
                {[r.firstName, r.lastName].filter(Boolean).join(' ') || '—'}
                {r.verifiedAt && <Badge variant="success">★ Verified</Badge>}
                {r.status !== 'ACTIVE' && <Badge variant="destructive">{r.status}</Badge>}
              </span>
            ),
          },
          { header: 'Telegram', cell: (r) => (r.telegramUsername ? `@${r.telegramUsername}` : '—') },
          { header: 'Paid orders', cell: (r) => `${r.paidOrders} / ${r._count.orders}` },
          { header: 'Spent', cell: (r) => (Number(r.totalSpent) > 0 ? r.totalSpent : '—') },
          { header: 'Tickets', cell: (r) => r._count.supportTickets },
          { header: 'Joined', cell: (r) => new Date(r.createdAt).toLocaleDateString() },
        ]}
      />
    </>
  );
}
