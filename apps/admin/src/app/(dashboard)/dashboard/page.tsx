'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Boxes, LifeBuoy, Receipt, Truck, Users } from 'lucide-react';
import { Badge, Card, CardContent, Skeleton } from '@sqlm/ui';
import { api, type DashboardStats } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { useRealtime } from '@/hooks/use-realtime';

export default function DashboardPage() {
  const events = useRealtime();
  const { data, isLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.stats() as unknown as Promise<DashboardStats>,
    refetchInterval: 60_000,
  });

  const cards = [
    {
      label: 'Payment proofs to review',
      value: data?.pendingProofs,
      icon: Receipt,
      href: '/payment-proofs',
      urgent: (data?.pendingProofs ?? 0) > 0,
    },
    {
      label: 'Deliveries awaiting action',
      value: data?.pendingDeliveries,
      icon: Truck,
      href: '/deliveries',
      urgent: (data?.pendingDeliveries ?? 0) > 0,
    },
    {
      label: 'Unread support messages',
      value: data?.unreadTickets,
      icon: LifeBuoy,
      href: '/support',
      urgent: (data?.unreadTickets ?? 0) > 0,
    },
    {
      label: 'Low-stock products',
      value: data?.lowStockProducts,
      icon: Boxes,
      href: '/products',
      urgent: (data?.lowStockProducts ?? 0) > 0,
    },
    { label: 'Open tickets', value: data?.openTickets, icon: LifeBuoy, href: '/support' },
    { label: 'Customers', value: data?.customers, icon: Users, href: '/customers' },
  ];

  return (
    <>
      <PageHeader title="Dashboard" description="What needs attention right now." />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <Link key={card.label} href={card.href}>
              <Card className={card.urgent ? 'border-warning' : undefined}>
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-xs text-muted-foreground">{card.label}</p>
                    <p className="text-2xl font-semibold">{card.value ?? 0}</p>
                  </div>
                  <card.icon
                    className={`h-6 w-6 ${card.urgent ? 'text-warning' : 'text-muted-foreground'}`}
                  />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <p className="mb-3 text-sm font-medium">Orders by status</p>
            {Object.entries(data?.ordersByStatus ?? {}).length === 0 ? (
              <p className="text-sm text-muted-foreground">No orders yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {Object.entries(data?.ordersByStatus ?? {}).map(([status, count]) => (
                  <Badge key={status} variant="secondary">
                    {status.replace(/_/g, ' ').toLowerCase()}: {count}
                  </Badge>
                ))}
              </div>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              Confirmed revenue: <span className="font-medium">{data?.revenue ?? '0'}</span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-medium">
              Live activity
              <span className="h-2 w-2 animate-pulse rounded-full bg-success" />
            </p>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Connected — new orders, payments, deliveries and support replies appear here as they
                happen.
              </p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {events.slice(0, 10).map((event, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span>{event.summary}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
