'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { ORDER_STATUS_LABELS_AR, type OrderStatus } from '@sqlm/shared';
import { Card, CardContent, Input } from '@sqlm/ui';
import { adminApi } from '@/lib/admin-api';
import { formatDate, formatMoney } from '@/lib/format';
import { AdminTitle, customerName, Empty, ListSkeleton } from '@/components/admin/admin-ui';
import { OrderStatusBadge } from '@/components/orders/order-status-badge';

const FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'الكل' },
  { value: 'PAYMENT_REVIEW', label: 'مراجعة دفع' },
  { value: 'PENDING_PAYMENT', label: 'مستني دفع' },
  { value: 'PROCESSING', label: 'تجهيز' },
  { value: 'DELIVERED', label: 'اتسلّم' },
  { value: 'CANCELLED', label: 'ملغي' },
];

export default function AdminOrdersPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <OrdersList />
    </Suspense>
  );
}

function OrdersList() {
  const params = useSearchParams();
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const qs = new URLSearchParams({
    pageSize: '30',
    ...(status ? { status } : {}),
    ...(query ? { search: query } : {}),
  }).toString();
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'orders', qs],
    queryFn: () => adminApi.orders(qs),
  });

  return (
    <>
      <AdminTitle title="الطلبات" />
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(search.trim().replace(/^#/, ''));
        }}
      >
        <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="رقم الطلب أو اسم/يوزر العميل"
          className="ps-9"
        />
      </form>
      <div className="flex gap-1.5 overflow-x-auto">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatus(f.value)}
            className={`shrink-0 rounded-full border px-3 py-1 text-xs ${status === f.value ? 'border-primary bg-primary text-primary-foreground' : ''}`}
          >
            {f.label}
          </button>
        ))}
        {status && !FILTERS.some((f) => f.value === status) && (
          <span className="shrink-0 rounded-full border border-primary bg-primary px-3 py-1 text-xs text-primary-foreground">
            {ORDER_STATUS_LABELS_AR[status as OrderStatus] ?? status}
          </span>
        )}
      </div>
      {isLoading ? (
        <ListSkeleton />
      ) : !data?.items.length ? (
        <Empty>مفيش طلبات.</Empty>
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {data.items.map((o) => (
              <Link
                key={o.id}
                href={`/admin/orders/${o.id}`}
                className="flex items-center gap-3 p-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    #{o.sequenceNumber}{' '}
                    <span className="font-normal text-muted-foreground">
                      · {o.customer ? customerName(o.customer) : ''}
                    </span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {o.items
                      .map(
                        (i) => `${i.productNameSnapshot}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`,
                      )
                      .join('، ')}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatDate(o.createdAt)}
                    {o.walletPaid
                      ? ' · 💳 محفظة'
                      : o.paymentMethod
                        ? ` · ${o.paymentMethod.name}`
                        : ''}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="font-semibold tabular-nums" dir="ltr">
                    {formatMoney(o.total, o.currency)}
                  </span>
                  <OrderStatusBadge status={o.status as OrderStatus} />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
      {data && data.total > data.items.length && (
        <p className="text-center text-xs text-muted-foreground">
          بيظهر أحدث {data.items.length} من {data.total} — استخدم البحث.
        </p>
      )}
    </>
  );
}
