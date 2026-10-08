'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, Input } from '@sqlm/ui';
import { api, ApiError } from '@/lib/api';
import { Checkbox, Select, Textarea } from '@/components/form';
import { PageHeader } from '@/components/layout/page-header';
import { useAuthStore } from '@/store/auth-store';
import { CustomerWalletCard } from '@/components/customer-wallet-card';

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
  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: ['customer', id] });
    void queryClient.invalidateQueries({ queryKey: ['customers'] });
  };
  const ban = useMutation({
    mutationFn: (reason: string) => api.banCustomer(id, reason),
    onSuccess: (res) => {
      refresh();
      if (res.cancelledOrders > 0) window.alert(`Banned. ${res.cancelledOrders} unpaid order(s) cancelled and their stock released.`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Ban failed'),
  });
  const unban = useMutation({
    mutationFn: () => api.unbanCustomer(id),
    onSuccess: refresh,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Unban failed'),
  });

  const [message, setMessage] = useState('');
  const [withStore, setWithStore] = useState(true);
  const [sent, setSent] = useState(false);
  const sendMessage = useMutation({
    mutationFn: () => api.messageCustomer(id, message.trim(), withStore),
    onSuccess: () => {
      setMessage('');
      setSent(true);
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Message failed'),
  });

  const [suspendHours, setSuspendHours] = useState('24');
  const [suspendReason, setSuspendReason] = useState('');
  const suspend = useMutation({
    mutationFn: () => api.suspendCustomer(id, Number(suspendHours), suspendReason.trim() || 'قرار الإدارة'),
    onSuccess: () => {
      setSuspendReason('');
      refresh();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Suspend failed'),
  });
  const lift = useMutation({
    mutationFn: () => api.liftSuspension(id),
    onSuccess: refresh,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed'),
  });
  const revokeWholesale = useMutation({
    mutationFn: () => api.revokeWholesale(id),
    onSuccess: refresh,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed'),
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
        action={
          <Badge variant={customer.status === 'BANNED' ? 'destructive' : 'secondary'}>{customer.status}</Badge>
        }
      />

      {customer.suspendedUntil && new Date(customer.suspendedUntil) > new Date() && customer.status !== 'BANNED' && (
        <Card className="mb-6 border-warning/60 bg-warning/10">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <div className="min-w-0">
              <p className="font-medium">⏸️ Suspended until {new Date(customer.suspendedUntil).toLocaleString()}</p>
              <p className="text-muted-foreground" dir="auto">
                {customer.suspendReason ?? '—'}
              </p>
            </div>
            {can('customers.ban') && (
              <Button size="sm" variant="outline" disabled={lift.isPending} onClick={() => lift.mutate()}>
                Lift suspension
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {customer.status === 'BANNED' && (
        <Card className="mb-6 border-destructive/50 bg-destructive/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <div>
              <p className="font-medium text-destructive">🚫 Banned{customer.bannedAt ? ` on ${new Date(customer.bannedAt).toLocaleDateString()}` : ''}</p>
              <p className="text-muted-foreground">
                {customer.banReason ?? 'No reason recorded'} — the bot ignores them and the Mini App refuses to sign them in.
              </p>
            </div>
            {can('customers.ban') && (
              <Button size="sm" variant="outline" disabled={unban.isPending} onClick={() => unban.mutate()}>
                Lift ban
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-medium">
              {customer.verifiedAt ? (
                <Badge variant="success">★ Verified customer</Badge>
              ) : (
                <Badge variant="outline">Regular customer</Badge>
              )}
            </div>
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
            {(customer.fullName || customer.contactPhone) && (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span dir="auto">👤 {customer.fullName ?? '—'}</span>
                {customer.contactPhone && (
                  <a href={`tel:${customer.contactPhone}`} className="text-primary underline" dir="ltr">
                    {customer.contactPhone}
                  </a>
                )}
                <span className="text-xs text-muted-foreground">(from their first order)</span>
              </p>
            )}
            {customer.phone && <p className="text-muted-foreground">📱 +{customer.phone} (shared from their Telegram)</p>}
            {customer.wholesaleAt && (
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">🏪 Wholesale member</Badge>
                <span className="text-xs text-muted-foreground">since {new Date(customer.wholesaleAt).toLocaleDateString()}</span>
                {can('customers.write') && (
                  <button
                    className="text-xs text-destructive underline"
                    disabled={revokeWholesale.isPending}
                    onClick={() => window.confirm('Remove wholesale membership?') && revokeWholesale.mutate()}
                  >
                    Revoke
                  </button>
                )}
              </div>
            )}
            {customer.legacyEntry && (
              <div>
                <Badge variant="success">Old customer</Badge>{' '}
                {customer.legacyEntry.name ? `${customer.legacyEntry.name} · ` : ''}
                {customer.legacyEntry.discountPercent !== null
                  ? `${customer.legacyEntry.discountPercent}% (own rate)`
                  : 'Settings rate'}
              </div>
            )}
            {customer.rejectedProofs > 0 && (
              <p className="text-destructive">⚠️ {customer.rejectedProofs} rejected payment proof(s)</p>
            )}
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
          {can('customers.ban') && customer.status !== 'BANNED' && (
            <Button
              size="sm"
              variant="destructive"
              disabled={ban.isPending}
              onClick={() => {
                const reason = window.prompt(
                  'Ban this customer? Their unpaid orders are cancelled and the bot stops answering them.\n\nReason (shown to them):',
                  'إيصال مزيف أو تحويل غير حقيقي',
                );
                if (reason?.trim()) ban.mutate(reason.trim());
              }}
            >
              Ban customer
            </Button>
          )}
          {error && <p className="w-full text-xs text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <CustomerWalletCard customerId={id} />

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        {can('customers.write') && (
          <Card>
            <CardContent className="space-y-3 p-4">
              <p className="text-sm font-medium">✉️ Message on Telegram</p>
              <Textarea
                dir="auto"
                rows={4}
                maxLength={2000}
                value={message}
                placeholder="اكتب رسالتك للعميل — هتوصله من البوت"
                onChange={(e) => {
                  setMessage(e.target.value);
                  setSent(false);
                }}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Checkbox label="Add an “Open store” button" checked={withStore} onChange={setWithStore} />
                <Button size="sm" disabled={!message.trim() || sendMessage.isPending} onClick={() => sendMessage.mutate()}>
                  {sendMessage.isPending ? 'Sending…' : 'Send'}
                </Button>
              </div>
              {sent && <p className="text-xs text-success">✓ Sent — it is also in their in-app notifications.</p>}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm font-medium">🛡️ Security</p>
            {can('customers.ban') && customer.status !== 'BANNED' && (
              <div className="grid gap-2 sm:grid-cols-[8rem,1fr,auto] sm:items-end">
                <Select
                  aria-label="Suspend for"
                  value={suspendHours}
                  onChange={(e) => setSuspendHours(e.target.value)}
                  options={[
                    { value: '1', label: '1 hour' },
                    { value: '6', label: '6 hours' },
                    { value: '24', label: '24 hours' },
                    { value: '72', label: '3 days' },
                    { value: '168', label: '7 days' },
                  ]}
                />
                <Input
                  dir="auto"
                  value={suspendReason}
                  placeholder="Reason (sent to the customer)"
                  onChange={(e) => setSuspendReason(e.target.value)}
                />
                <Button size="sm" variant="outline" disabled={suspend.isPending} onClick={() => suspend.mutate()}>
                  Suspend
                </Button>
              </div>
            )}
            {customer.strikes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No strikes — nothing suspicious recorded.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {customer.strikes.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-x-3 border-t pt-1.5 first:border-t-0 first:pt-0">
                    <span dir="auto">
                      <Badge variant={s.action === 'BAN' ? 'destructive' : 'warning'} className="mr-1.5">
                        {s.action === 'BAN' ? 'ban' : 'suspend'}
                      </Badge>
                      {s.reason}
                    </span>
                    <span className="text-xs text-muted-foreground">{new Date(s.createdAt).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
            {customer.appeals.length > 0 && (
              <div className="space-y-1.5 border-t pt-2">
                <p className="text-xs font-medium text-muted-foreground">Appeals</p>
                {customer.appeals.map((a) => (
                  <Link key={a.id} href="/appeals" className="block text-sm hover:underline" dir="auto">
                    <Badge variant={a.status === 'PENDING' ? 'warning' : a.status === 'ACCEPTED' ? 'success' : 'secondary'} className="mr-1.5">
                      {a.status.toLowerCase()}
                    </Badge>
                    {a.message.slice(0, 120)}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
