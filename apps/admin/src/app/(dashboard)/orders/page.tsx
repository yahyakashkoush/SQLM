'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ORDER_STATUSES } from '@sqlm/shared';
import { Badge, Button, Input } from '@sqlm/ui';
import { api, ApiError, type AdminOrder } from '@/lib/api';
import { useAuthStore } from '@/store/auth-store';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data-table';
import { statusLabel, statusVariant } from '@/lib/order-status';

const QUICK_FILTERS = [
  { value: '', label: 'All' },
  { value: 'PAYMENT_REVIEW', label: 'Payment to review' },
  { value: 'READY_FOR_DELIVERY', label: 'Needs delivery' },
  { value: 'PENDING_PAYMENT', label: 'Awaiting payment' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export default function OrdersPage() {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const canDelete = useAuthStore((s) => s.can('orders.delete'));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [restock, setRestock] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const bulkDelete = useMutation({
    mutationFn: () => api.deleteOrders([...selected], restock),
    onSuccess: (res) => {
      setSelected(new Set());
      setNotice(
        `Deleted ${res.deleted.length} order(s)` + (res.failed.length ? ` · ${res.failed.length} failed` : '') + '.',
      );
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
    onError: (err) => setNotice(err instanceof ApiError ? err.message : 'Delete failed'),
  });

  const qs = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (status) qs.set('status', status);
  if (search.trim()) qs.set('search', search.trim());
  const { data, isLoading, error } = useQuery({
    queryKey: ['orders', qs.toString()],
    queryFn: () => api.orders(`?${qs}`),
    refetchInterval: 30_000,
  });

  return (
    <>
      <PageHeader title="Orders" description="Every order, newest first. Click one to review payment and deliver it." />

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {QUICK_FILTERS.map((f) => (
          <Button
            key={f.value}
            size="sm"
            variant={status === f.value ? 'default' : 'outline'}
            onClick={() => {
              setStatus(f.value);
              setPage(1);
            }}
          >
            {f.label}
          </Button>
        ))}
        <select
          value={QUICK_FILTERS.some((f) => f.value === status) ? '' : status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="h-8 rounded-md border bg-transparent px-2 text-xs"
        >
          <option value="">Other status…</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
      </div>
      <Input
        className="mb-4 max-w-sm"
        placeholder="Search: order number, customer name or @username"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
      />

      {canDelete && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <Button
            size="sm"
            variant="outline"
            disabled={!data?.items.length}
            onClick={() => setSelected(new Set(data?.items.map((o) => o.id)))}
          >
            Select this page
          </Button>
          {selected.size > 0 && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear ({selected.size})
              </Button>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
                Also return paid orders&apos; items to stock (test orders)
              </label>
              <Button
                size="sm"
                variant="destructive"
                disabled={bulkDelete.isPending}
                onClick={() =>
                  window.confirm(
                    `Permanently delete ${selected.size} order(s)? This cannot be undone. Unpaid orders give their stock back.`,
                  ) && bulkDelete.mutate()
                }
              >
                Delete {selected.size} order(s)
              </Button>
            </>
          )}
          {notice && <span className="text-xs text-muted-foreground">{notice}</span>}
        </div>
      )}

      <DataTable<AdminOrder>
        rows={data?.items}
        isLoading={isLoading}
        error={error}
        empty="No orders match."
        onRowClick={(row) => router.push(`/orders/${row.id}`)}
        columns={[
          ...(canDelete
            ? [
                {
                  header: '',
                  cell: (r: AdminOrder) => (
                    <input
                      type="checkbox"
                      aria-label={`Select order ${r.sequenceNumber}`}
                      checked={selected.has(r.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggle(r.id)}
                    />
                  ),
                },
              ]
            : []),
          { header: 'Order', cell: (r) => <span className="font-medium">#{r.sequenceNumber}</span> },
          {
            header: 'Customer',
            cell: (r) => (
              <span dir="auto">
                {r.customer?.firstName ?? '—'}
                {r.customer?.telegramUsername && (
                  <span className="text-xs text-muted-foreground"> @{r.customer.telegramUsername}</span>
                )}
              </span>
            ),
          },
          {
            header: 'Items',
            cell: (r) => (
              <span dir="auto" className="text-xs">
                {r.items.map((i) => `${i.productNameSnapshot} ×${i.quantity}`).join('، ')}
              </span>
            ),
          },
          { header: 'Total', cell: (r) => `${r.total} ${r.currency}` },
          { header: 'Payment', cell: (r) => <span className="text-xs">{r.paymentMethod?.name ?? '—'}</span> },
          { header: 'Status', cell: (r) => <Badge variant={statusVariant(r.status)}>{statusLabel(r.status)}</Badge> },
          { header: 'Placed', cell: (r) => <span className="text-xs">{new Date(r.createdAt).toLocaleString()}</span> },
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
          <Button size="sm" variant="outline" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </>
  );
}
