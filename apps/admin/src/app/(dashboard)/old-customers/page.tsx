'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, Input } from '@sqlm/ui';
import { api, ApiError, type LegacyCustomer } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data-table';
import { useAuthStore } from '@/store/auth-store';

export default function OldCustomersPage() {
  const queryClient = useQueryClient();
  const canWrite = useAuthStore((s) => s.can('customers.write'));
  const [search, setSearch] = useState('');
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['legacy-customers', search],
    queryFn: () => api.legacyCustomers(search.trim()),
  });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => api.settings() });
  const percent = settings?.settings.find((s) => s.key === 'customers.legacyDiscountPercent')?.value;

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['legacy-customers'] });
  const fail = (err: unknown) => setMessage(err instanceof ApiError ? err.message : 'Something went wrong');

  const importList = useMutation({
    mutationFn: () => api.importLegacyCustomers(text),
    onSuccess: (res) => {
      setText('');
      setMessage(
        `Added ${res.added}, updated ${res.updated}.` +
          (res.invalid.length ? ` Skipped ${res.invalid.length} line(s) that were not phone numbers: ${res.invalid.slice(0, 5).join(' | ')}` : ''),
      );
      refresh();
    },
    onError: fail,
  });
  const setRate = useMutation({
    mutationFn: ({ id, value }: { id: string; value: number | null }) =>
      api.updateLegacyCustomer(id, { discountPercent: value }),
    onSuccess: refresh,
    onError: fail,
  });
  const release = useMutation({ mutationFn: (id: string) => api.releaseLegacyCustomer(id), onSuccess: refresh, onError: fail });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteLegacyCustomer(id), onSuccess: refresh, onError: fail });

  return (
    <>
      <PageHeader
        title="Old Customers"
        description="Customers you had before this store. When one of them opens the bot and taps «🎁 عميل قديم؟», Telegram shares their own number — if it is on this list they get the old-customer discount on every order."
      />

      <Card className="mb-6">
        <CardContent className="space-y-2 p-4 text-sm">
          <p>
            Discount for old customers:{' '}
            <strong>{typeof percent === 'number' ? `${percent}%` : '…'}</strong>{' '}
            <Link href="/settings" className="text-primary underline">
              change in Settings → Customers
            </Link>
            . {percent === 0 && <span className="text-destructive">It is 0, so the offer is hidden from customers.</span>}
          </p>
          <p className="text-muted-foreground">
            A number is claimed once, by one Telegram account, and only by sharing it from that account — typing
            someone else&apos;s number does nothing. A claimed old customer also counts as verified; if both discounts
            apply they get the larger one.
          </p>
        </CardContent>
      </Card>

      {canWrite && (
        <Card className="mb-6">
          <CardContent className="space-y-2 p-4">
            <p className="text-sm font-medium">Add numbers</p>
            <p className="text-xs text-muted-foreground">
              One per line: <code>phone</code>, optionally followed by a name and a percentage for that person —
              e.g. <code>01012345678, Ahmed, 20</code>. Pasting a spreadsheet column works. Numbers already on the list
              are updated, never duplicated.
            </p>
            <textarea
              dir="ltr"
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'01012345678, Ahmed\n+20 111 222 3333, Mona, 15\n01234567890'}
              className="w-full rounded-md border bg-transparent p-2 font-mono text-sm"
            />
            <Button disabled={!text.trim() || importList.isPending} onClick={() => importList.mutate()}>
              {importList.isPending ? 'Importing…' : 'Import'}
            </Button>
          </CardContent>
        </Card>
      )}

      {message && <p className="mb-3 text-sm text-muted-foreground">{message}</p>}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input
          className="max-w-xs"
          placeholder="Search number or name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {data && (
          <span className="text-sm text-muted-foreground">
            {data.total} on the list · {data.claimed} claimed
          </span>
        )}
      </div>

      <DataTable<LegacyCustomer>
        rows={data?.items}
        isLoading={isLoading}
        error={error}
        empty="No old customers yet — paste their numbers above."
        columns={[
          { header: 'Phone', cell: (r) => <span className="font-mono text-xs">+{r.phone}</span> },
          { header: 'Name', cell: (r) => <span dir="auto">{r.name ?? '—'}</span> },
          {
            header: 'Discount',
            cell: (r) =>
              canWrite ? (
                <select
                  className="h-8 rounded-md border bg-transparent px-2 text-xs"
                  value={r.discountPercent ?? ''}
                  onChange={(e) =>
                    setRate.mutate({ id: r.id, value: e.target.value === '' ? null : Number(e.target.value) })
                  }
                >
                  <option value="">Settings ({typeof percent === 'number' ? `${percent}%` : '—'})</option>
                  {[5, 10, 15, 20, 25, 30, 40, 50].map((n) => (
                    <option key={n} value={n}>
                      {n}%
                    </option>
                  ))}
                  {r.discountPercent !== null && ![5, 10, 15, 20, 25, 30, 40, 50].includes(r.discountPercent) && (
                    <option value={r.discountPercent}>{r.discountPercent}%</option>
                  )}
                </select>
              ) : (
                <span>{r.discountPercent !== null ? `${r.discountPercent}%` : 'Settings'}</span>
              ),
          },
          {
            header: 'Claimed by',
            cell: (r) =>
              r.claimedBy ? (
                <Link href={`/customers/${r.claimedBy.id}`} className="text-primary underline" dir="auto">
                  {r.claimedBy.firstName ?? 'Customer'}
                  {r.claimedBy.telegramUsername ? ` @${r.claimedBy.telegramUsername}` : ''}
                </Link>
              ) : (
                <Badge variant="outline">Not yet</Badge>
              ),
          },
          {
            header: 'Actions',
            cell: (r) =>
              canWrite && (
                <div className="flex gap-1">
                  {r.claimedById && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        window.confirm('Detach this number from its Telegram account so it can be claimed again?') &&
                        release.mutate(r.id)
                      }
                    >
                      Release
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() =>
                      window.confirm(`Remove +${r.phone} from the list? A customer who claimed it loses the discount.`) &&
                      remove.mutate(r.id)
                    }
                  >
                    Remove
                  </Button>
                </div>
              ),
          },
        ]}
      />
    </>
  );
}
