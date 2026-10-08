'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ClipboardList, PackageX, Receipt, Store, Truck, Wallet } from 'lucide-react';
import { ORDER_STATUS_LABELS_AR, type OrderStatus } from '@sqlm/shared';
import { Card, CardContent, Skeleton } from '@sqlm/ui';
import { adminApi, staffCan } from '@/lib/admin-api';
import { formatMoney } from '@/lib/format';
import { Stat } from '@/components/admin/admin-ui';

const today = () => new Date().toISOString().slice(0, 10);

export default function AdminHome() {
  const stats = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: adminApi.stats,
    enabled: staffCan('orders.read'),
  });
  const profits = useQuery({
    queryKey: ['admin', 'profits', 'today'],
    queryFn: () => adminApi.profits(today(), today()),
    enabled: staffCan('analytics.read'),
  });
  const topUps = useQuery({
    queryKey: ['admin', 'topups', 'PENDING'],
    queryFn: () => adminApi.topUps('PENDING'),
    enabled: staffCan('payments.proofs.read'),
  });
  const wholesale = useQuery({
    queryKey: ['admin', 'wholesale', 'PENDING'],
    queryFn: () => adminApi.wholesale('PENDING'),
    enabled: staffCan('customers.read'),
  });

  const s = stats.data;
  const todo = [
    {
      href: '/admin/proofs',
      label: 'إيصالات مستنية مراجعة',
      count: s?.pendingProofs ?? 0,
      icon: Receipt,
      show: staffCan('payments.proofs.read'),
    },
    {
      href: '/admin/topups',
      label: 'طلبات شحن رصيد',
      count: topUps.data?.length ?? 0,
      icon: Wallet,
      show: staffCan('payments.proofs.read'),
    },
    {
      href: '/admin/orders?status=READY_FOR_DELIVERY',
      label: 'طلبات محتاجة تسليم يدوي',
      count: s?.pendingDeliveries ?? 0,
      icon: Truck,
      show: staffCan('orders.read'),
    },
    {
      href: '/admin/wholesale',
      label: 'طلبات عضوية جملة',
      count: wholesale.data?.length ?? 0,
      icon: Store,
      show: staffCan('customers.read'),
    },
    {
      href: '/admin/products',
      label: 'منتجات قربت تخلص',
      count: s?.lowStockProducts ?? 0,
      icon: PackageX,
      show: staffCan('products.read'),
    },
  ].filter((t) => t.show);
  const waiting = todo.filter((t) => t.count > 0);
  const p = profits.data;

  return (
    <>
      {staffCan('analytics.read') && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">النهارده</h2>
          {p ? (
            <div className="grid grid-cols-3 gap-2">
              <Stat
                label="الإيراد"
                value={formatMoney(p.totals.revenue, p.currency)}
                sub={`${p.totals.orders} طلب`}
              />
              <Stat label="التكلفة" value={formatMoney(p.totals.cost, p.currency)} />
              <Stat
                label="الربح"
                value={formatMoney(p.totals.profit, p.currency)}
                sub={p.totals.margin === null ? undefined : `${p.totals.margin}%`}
                tone={Number(p.totals.profit) < 0 ? 'bad' : 'good'}
              />
            </div>
          ) : (
            <Skeleton className="h-20 w-full rounded-xl" />
          )}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{waiting.length ? 'مستنيك' : 'كله تمام 🎉'}</h2>
        <Card>
          <CardContent className="divide-y p-0">
            {(waiting.length ? waiting : todo).map(({ href, label, count, icon: Icon }) => (
              <Link key={href} href={href} className="flex items-center gap-3 p-3 text-sm">
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full ${count ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="flex-1">{label}</span>
                {count > 0 && (
                  <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-bold text-destructive-foreground">
                    {count}
                  </span>
                )}
                <ChevronLeft className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>
      </section>

      {s && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <ClipboardList className="h-4 w-4" /> الطلبات حسب الحالة
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {(Object.entries(s.ordersByStatus) as Array<[OrderStatus, number]>)
              .sort((a, b) => b[1] - a[1])
              .map(([status, count]) => (
                <Link
                  key={status}
                  href={`/admin/orders?status=${status}`}
                  className="flex items-center justify-between rounded-xl border bg-card px-3 py-2 text-sm"
                >
                  <span className="text-muted-foreground">
                    {ORDER_STATUS_LABELS_AR[status] ?? status}
                  </span>
                  <span className="font-semibold tabular-nums">{count}</span>
                </Link>
              ))}
          </div>
          <p className="text-center text-xs text-muted-foreground">
            {s.customers} عميل · {s.openTickets} تذكرة دعم مفتوحة
          </p>
        </section>
      )}
    </>
  );
}
