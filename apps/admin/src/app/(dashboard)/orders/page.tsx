'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ORDER_STATUSES } from '@sqlm/shared';
import { Badge, Button } from '@sqlm/ui';
import { api, type AdminOrder } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data-table';

export default function OrdersPage() {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const qs = `?page=${page}&pageSize=20${status ? `&status=${status}` : ''}`;
  const { data, isLoading, error } = useQuery({
    queryKey: ['orders', status, page],
    queryFn: () => api.orders(qs),
  });

  return (
    <>
      <PageHeader title="Orders" description="Every order, newest first." />

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Button size="sm" variant={status ? 'outline' : 'default'} onClick={() => setStatus('')}>
          All
        </Button>
        {ORDER_STATUSES.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={status === s ? 'default' : 'outline'}
            onClick={() => {
              setStatus(s);
              setPage(1);
            }}
          >
            {s.replace(/_/g, ' ').toLowerCase()}
          </Button>
        ))}
      </div>

      <DataTable<AdminOrder>
        rows={data?.items}
        isLoading={isLoading}
        error={error}
        empty="No orders match this filter."
        onRowClick={(row) => router.push(`/orders/${row.id}`)}
        columns={[
          { header: 'Order', cell: (r) => `#${r.sequenceNumber}` },
          { header: 'Status', cell: (r) => <Badge variant="secondary">{r.status}</Badge> },
          { header: 'Items', cell: (r) => r.items.length },
          { header: 'Total', cell: (r) => `${r.total} ${r.currency}` },
          { header: 'Placed', cell: (r) => new Date(r.createdAt).toLocaleString() },
        ]}
      />

      {data && data.totalPages > 1 && (
        <div className="mt-4 flex items-center gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-muted-foreground">
            Page {data.page} of {data.totalPages} ({data.total} orders)
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= data.totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </>
  );
}
