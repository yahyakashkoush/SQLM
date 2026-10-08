'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardContent, Input } from '@sqlm/ui';
import { api, ApiError, type WalletEntry } from '@/lib/api';
import { useAuthStore } from '@/store/auth-store';

const TYPE_LABEL: Record<WalletEntry['type'], string> = {
  TOPUP: 'Top-up',
  PURCHASE: 'Purchase',
  REFUND: 'Refund',
  ADJUSTMENT: 'Adjustment',
};

/** A merchant's balance, its full ledger, and a hand correction for owners. */
export function CustomerWalletCard({ customerId }: { customerId: string }) {
  const queryClient = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const { data } = useQuery({
    queryKey: ['customer-wallet', customerId],
    queryFn: () => api.customerWallet(customerId),
  });
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [type, setType] = useState<'ADJUSTMENT' | 'REFUND'>('ADJUSTMENT');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const adjust = useMutation({
    mutationFn: () =>
      api.adjustWallet(customerId, {
        amount: direction === 'credit' ? Number(amount) : -Number(amount),
        type: direction === 'credit' ? type : 'ADJUSTMENT',
        note: note.trim(),
      }),
    onSuccess: () => {
      setAmount('');
      setNote('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['customer-wallet', customerId] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed'),
  });

  if (!data) return null;
  if (!data.member && data.entries.length === 0) return null;

  return (
    <Card className="mb-6">
      <CardContent className="space-y-4 p-4 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-medium">💳 Wallet</p>
          <p className="text-2xl font-semibold tabular-nums">
            {Number(data.balance).toFixed(2)}{' '}
            <span className="text-sm font-normal text-muted-foreground">{data.currency}</span>
          </p>
        </div>

        {can('wallet.adjust') && (
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap gap-2">
              <div className="inline-flex rounded-md bg-muted p-0.5">
                {(['credit', 'debit'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDirection(d)}
                    className={`rounded px-3 py-1 text-xs ${direction === d ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}
                  >
                    {d === 'credit' ? '+ Add' : '− Deduct'}
                  </button>
                ))}
              </div>
              {direction === 'credit' && (
                <div className="inline-flex rounded-md bg-muted p-0.5">
                  {(['ADJUSTMENT', 'REFUND'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setType(t)}
                      className={`rounded px-3 py-1 text-xs ${type === t ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}
                    >
                      {TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Input
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                placeholder="Amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-28"
              />
              <Input
                dir="auto"
                placeholder="Note (the merchant sees it)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="min-w-0 flex-1"
              />
              <Button
                size="sm"
                disabled={adjust.isPending || !(Number(amount) > 0) || note.trim().length < 2}
                onClick={() => adjust.mutate()}
              >
                Apply
              </Button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}

        {data.entries.length === 0 ? (
          <p className="text-muted-foreground">No wallet activity yet.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[30rem] text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1.5 font-normal">When</th>
                  <th className="font-normal">What</th>
                  <th className="text-right font-normal">Amount</th>
                  <th className="text-right font-normal">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="py-1.5 text-muted-foreground">
                      {new Date(e.createdAt).toLocaleString()}
                    </td>
                    <td>
                      {TYPE_LABEL[e.type]}
                      {e.order && (
                        <Link
                          href={`/orders/${e.order.id}`}
                          className="ml-1 text-primary hover:underline"
                        >
                          #{e.order.sequenceNumber}
                        </Link>
                      )}
                      {e.note && (
                        <span className="ml-1 text-muted-foreground" dir="auto">
                          · {e.note}
                        </span>
                      )}
                      {e.staff && (
                        <span className="ml-1 text-muted-foreground">· {e.staff.name}</span>
                      )}
                    </td>
                    <td
                      className={`text-right tabular-nums ${Number(e.amount) >= 0 ? 'text-success' : 'text-destructive'}`}
                    >
                      {Number(e.amount) >= 0 ? '+' : ''}
                      {Number(e.amount).toFixed(2)}
                    </td>
                    <td className="text-right tabular-nums">{Number(e.balanceAfter).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
