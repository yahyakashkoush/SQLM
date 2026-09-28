'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent } from '@sqlm/ui';
import { api, ApiError } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { useAuthStore } from '@/store/auth-store';

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const [error, setError] = useState<string | null>(null);
  const { data: customer, isLoading } = useQuery({
    queryKey: ['customer', id],
    queryFn: () => api.customer(id),
  });
  const setVerified = useMutation({
    mutationFn: (verified: boolean) => api.setCustomerVerified(id, verified),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['customer', id] });
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Update failed'),
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

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <div className="space-y-1">
            <p className="flex items-center gap-2 font-medium">
              {customer.verifiedAt ? (
                <Badge variant="success">★ Verified customer</Badge>
              ) : (
                <Badge variant="outline">Regular customer</Badge>
              )}
            </p>
            <p className="text-muted-foreground">
              {customer.verifiedAt
                ? `Verified since ${new Date(customer.verifiedAt).toLocaleDateString()} — gets the verified discount on every order.`
                : customer.welcomeGiftOrderId
                  ? 'Welcome gift is held by an unpaid order; it comes back if that order is cancelled.'
                  : 'Becomes verified automatically when their first order is paid. The welcome gift applies to their first order.'}
            </p>
            <p>
              {customer.paidOrders} paid order{customer.paidOrders === 1 ? '' : 's'} · spent {customer.totalSpent}
            </p>
          </div>
          {can('customers.write') && (
            <Button
              size="sm"
              variant="outline"
              disabled={setVerified.isPending}
              onClick={() => {
                const next = !customer.verifiedAt;
                if (window.confirm(next ? 'Mark this customer as verified?' : 'Remove verified status?')) {
                  setVerified.mutate(next);
                }
              }}
            >
              {customer.verifiedAt ? 'Remove verified' : 'Mark verified'}
            </Button>
          )}
          {error && <p className="w-full text-xs text-destructive">{error}</p>}
        </CardContent>
      </Card>

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
