'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Card, CardContent, Input } from '@sqlm/ui';
import { adminApi } from '@/lib/admin-api';
import { AdminTitle, customerName, Empty, ListSkeleton, Tabs } from '@/components/admin/admin-ui';

const SEGMENTS = [
  { value: '', label: 'الكل' },
  { value: 'WHOLESALE', label: 'تجار' },
  { value: 'VERIFIED', label: 'مميزين' },
  { value: 'BANNED', label: 'محظورين' },
] as const;

export default function AdminCustomersPage() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [segment, setSegment] = useState<(typeof SEGMENTS)[number]['value']>('');
  const qs = new URLSearchParams({
    pageSize: '30',
    ...(query ? { search: query } : {}),
    ...(segment === 'BANNED' ? { status: 'BANNED' } : segment ? { segment } : {}),
  }).toString();
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'customers', qs],
    queryFn: () => adminApi.customers(qs),
  });

  return (
    <>
      <AdminTitle title="العملاء" />
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(search.trim().replace(/^@/, ''));
        }}
      >
        <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="اسم، يوزر، أو رقم موبايل"
          className="ps-9"
        />
      </form>
      <Tabs value={segment} onChange={setSegment} options={SEGMENTS} />
      {isLoading ? (
        <ListSkeleton />
      ) : !data?.items.length ? (
        <Empty>مفيش عملاء بالبحث ده.</Empty>
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {data.items.map((c) => (
              <Link
                key={c.id}
                href={`/admin/customers/${c.id}`}
                className="flex items-center justify-between gap-3 p-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {customerName(c)}{' '}
                    {c.status === 'BANNED' && (
                      <span className="text-xs text-destructive">· محظور</span>
                    )}
                    {c.verifiedAt && <span className="text-xs"> ⭐</span>}
                  </p>
                  {c.telegramUsername && (
                    <p className="text-xs text-muted-foreground" dir="ltr">
                      @{c.telegramUsername}
                    </p>
                  )}
                </div>
                <div className="text-end text-xs text-muted-foreground">
                  <p>{c.paidOrders} طلب مدفوع</p>
                  <p className="tabular-nums" dir="ltr">
                    {Number(c.totalSpent).toFixed(2)}
                  </p>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
