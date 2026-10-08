'use client';

import Link from 'next/link';
import { Package } from 'lucide-react';
import { Button, Card, CardContent, Skeleton } from '@sqlm/ui';
import { useOrders } from '@/lib/queries';
import { useAuthStore } from '@/store/auth-store';
import { OrderStatusBadge } from '@/components/orders/order-status-badge';
import { formatDate, formatMoney } from '@/lib/format';

export default function OrdersPage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const orders = useOrders();

  if (!accessToken) {
    return (
      <main className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-muted-foreground">افتح التطبيق من جوه تيليجرام علشان تشوف طلباتك.</p>
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">طلباتي</h1>
      {orders.isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : orders.data?.items.length ? (
        <div className="flex flex-col gap-3">
          {orders.data.items.map((order) => (
            <Link key={order.id} href={`/orders/${order.id}`}>
              <Card>
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">طلب #{order.sequenceNumber}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {order.items.map((i) => i.productNameSnapshot).join('، ')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(order.createdAt)} · {formatMoney(order.total, order.currency)}
                    </p>
                  </div>
                  <OrderStatusBadge status={order.status} />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Package className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">لسه معندكش طلبات.</p>
          <Link href="/products">
            <Button>تصفح المنتجات</Button>
          </Link>
        </div>
      )}
    </main>
  );
}
