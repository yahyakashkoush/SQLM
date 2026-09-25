'use client';

import Link from 'next/link';
import { Card, CardContent, Skeleton } from '@sqlm/ui';
import { useOrders } from '@/lib/queries';
import { useAuthStore } from '@/store/auth-store';
import { OrderStatusBadge } from '@/components/orders/order-status-badge';
import { formatMoney } from '@/lib/format';

export default function OrdersPage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const orders = useOrders();

  if (!accessToken) {
    return (
      <main className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Open this Mini App from Telegram to see your orders.
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">Your Orders</h1>
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
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm font-medium">Order #{order.sequenceNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(order.createdAt).toLocaleDateString()} ·{' '}
                      {formatMoney(order.total, order.currency)}
                    </p>
                  </div>
                  <OrderStatusBadge status={order.status} />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">You haven&apos;t placed any orders yet.</p>
      )}
    </main>
  );
}
