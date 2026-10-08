'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardContent } from '@sqlm/ui';
import { ApiError } from '@/lib/api';
import { adminApi, staffCan, type WholesaleApp } from '@/lib/admin-api';
import { formatDate } from '@/lib/format';
import { AdminTitle, customerName, Empty, ListSkeleton, Tabs } from '@/components/admin/admin-ui';

const TABS = [
  { value: 'PENDING', label: 'مستنية' },
  { value: 'APPROVED', label: 'التجار' },
  { value: 'REJECTED', label: 'مرفوضة' },
] as const;

export default function AdminWholesalePage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['value']>('PENDING');
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'wholesale', tab],
    queryFn: () => adminApi.wholesale(tab),
  });
  return (
    <>
      <AdminTitle
        title="تجار الجملة"
        hint="التاجر المقبول بيشوف أسعار الجملة اللي معلّم عليها في كل منتج، ويقدر يشحن رصيد."
      />
      <Tabs value={tab} onChange={setTab} options={TABS} />
      {isLoading ? (
        <ListSkeleton />
      ) : !data?.length ? (
        <Empty>مفيش طلبات هنا.</Empty>
      ) : (
        data.map((a) => <AppCard key={a.id} app={a} />)
      )}
    </>
  );
}

function AppCard({ app: a }: { app: WholesaleApp }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const review = useMutation({
    mutationFn: (approve: boolean) => adminApi.reviewWholesale(a.id, approve),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin'] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'حصل خطأ'),
  });
  return (
    <Card>
      <CardContent className="space-y-2 p-4 text-sm">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold">🏪 {a.businessName}</p>
            <Link href={`/admin/customers/${a.customer.id}`} className="text-xs text-primary">
              {customerName(a.customer)}
            </Link>
          </div>
          <span className="text-xs text-muted-foreground">{formatDate(a.createdAt)}</span>
        </div>
        <a href={`tel:${a.contactPhone}`} className="block text-xs text-primary" dir="ltr">
          {a.contactPhone}
        </a>
        {a.monthlyVolume && (
          <p className="text-xs text-muted-foreground">الكمية الشهرية: {a.monthlyVolume}</p>
        )}
        {a.notes && <p className="whitespace-pre-wrap text-xs text-muted-foreground">{a.notes}</p>}
        {a.status === 'PENDING' && staffCan('customers.write') && (
          <div className="flex gap-2 pt-1">
            <Button
              className="flex-1"
              disabled={review.isPending}
              onClick={() => review.mutate(true)}
            >
              ✓ قبول
            </Button>
            <Button
              variant="outline"
              disabled={review.isPending}
              onClick={() => review.mutate(false)}
            >
              رفض
            </Button>
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
