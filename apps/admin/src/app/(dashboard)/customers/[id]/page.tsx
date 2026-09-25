'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, CardContent } from '@sqlm/ui';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: customer, isLoading } = useQuery({
    queryKey: ['customer', id],
    queryFn: () => api.customer(id),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!customer) return <p className="text-sm text-muted-foreground">Customer not found.</p>;

  return (
    <>
      <PageHeader
        title={[customer.firstName, customer.lastName].filter(Boolean).join(' ') || 'Customer'}
        description={
          customer.telegramUsername ? `@${customer.telegramUsername}` : `Joined ${new Date(customer.createdAt).toLocaleDateString()}`
        }
        action={<Badge variant="secondary">{customer.status}</Badge>}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <p className="mb-2 text-sm font-medium">Orders</p>
            {customer.orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No orders yet.</p>
            ) : (
              customer.orders.map((o) => (
                <Link key={o.id} href={`/orders/${o.id}`}>
                  <div className="flex justify-between border-t py-2 text-sm first:border-t-0 hover:bg-accent/50">
                    <span>#{o.sequenceNumber}</span>
                    <span className="text-muted-foreground">{o.status}</span>
                    <span>{o.total}</span>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="mb-2 text-sm font-medium">Support tickets</p>
            {customer.supportTickets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tickets.</p>
            ) : (
              customer.supportTickets.map((t) => (
                <Link key={t.id} href={`/support/${t.id}`}>
                  <div className="flex justify-between border-t py-2 text-sm first:border-t-0 hover:bg-accent/50">
                    <span>
                      #{t.ticketNumber} {t.subject}
                    </span>
                    <span className="text-muted-foreground">{t.status}</span>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
