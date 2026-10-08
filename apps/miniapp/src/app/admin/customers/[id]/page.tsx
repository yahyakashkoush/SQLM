'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Loader2 } from 'lucide-react';
import { ORDER_STATUS_LABELS_AR, type OrderStatus } from '@sqlm/shared';
import { Button, Card, CardContent, Input, Skeleton } from '@sqlm/ui';
import { ApiError } from '@/lib/api';
import { adminApi, staffCan } from '@/lib/admin-api';
import { formatDate, formatMoney } from '@/lib/format';
import { customerName } from '@/components/admin/admin-ui';

type Panel = 'message' | 'suspend' | 'ban' | 'wallet' | null;

export default function AdminCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const { data: c, isLoading } = useQuery({
    queryKey: ['admin', 'customer', id],
    queryFn: () => adminApi.customer(id),
  });
  const wallet = useQuery({
    queryKey: ['admin', 'wallet', id],
    queryFn: () => adminApi.wallet(id),
    enabled: Boolean(c?.wholesaleAt),
  });
  const [panel, setPanel] = useState<Panel>(null);
  const [text, setText] = useState('');
  const [hours, setHours] = useState(24);
  const [amount, setAmount] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = useMutation({
    mutationFn: async (kind: 'message' | 'suspend' | 'ban' | 'lift' | 'unban' | 'wallet') => {
      switch (kind) {
        case 'message':
          await adminApi.message(id, text.trim());
          return 'الرسالة اتبعتت ✅';
        case 'suspend':
          await adminApi.suspend(id, hours, text.trim() || 'قرار الإدارة');
          return `اتوقف ${hours} ساعة`;
        case 'ban': {
          const r = await adminApi.ban(id, text.trim() || 'قرار الإدارة');
          return `اتحظر نهائي — اتلغى ${r.cancelledOrders} طلب مش مدفوع`;
        }
        case 'lift':
          await adminApi.lift(id);
          return 'اترفع الإيقاف';
        case 'unban':
          await adminApi.unban(id);
          return 'اترفع الحظر';
        case 'wallet': {
          const r = await adminApi.adjustWallet(id, Number(amount), text.trim());
          return `الرصيد دلوقتي ${r.balance}`;
        }
      }
    },
    onSuccess: (message) => {
      setNotice(message);
      setError(null);
      setPanel(null);
      setText('');
      setAmount('');
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'حصل خطأ'),
  });

  if (isLoading || !c) return <Skeleton className="h-72 w-full rounded-xl" />;
  const suspended = c.suspendedUntil && new Date(c.suspendedUntil) > new Date();
  const open = (p: Panel) => (
    setPanel(panel === p ? null : p),
    setText(''),
    setError(null),
    setNotice(null)
  );

  return (
    <>
      <Link
        href="/admin/customers"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground"
      >
        <ChevronRight className="h-4 w-4" /> العملاء
      </Link>

      <Card>
        <CardContent className="space-y-1 p-4 text-sm">
          <p className="text-base font-semibold">
            {customerName(c)} {c.verifiedAt && '⭐'} {c.wholesaleAt && '🏪'}
          </p>
          {c.telegramUsername && (
            <p className="text-xs text-muted-foreground" dir="ltr">
              @{c.telegramUsername}
            </p>
          )}
          {(c.contactPhone || c.phone) && (
            <a
              href={`tel:${c.contactPhone ?? `+${c.phone}`}`}
              className="block text-xs text-primary"
              dir="ltr"
            >
              {c.contactPhone ?? `+${c.phone}`}
            </a>
          )}
          <p className="text-xs text-muted-foreground">
            من {formatDate(c.createdAt)} · {c.paidOrders} طلب مدفوع ·{' '}
            {Number(c.totalSpent).toFixed(2)}
          </p>
          {c.status === 'BANNED' && (
            <p className="text-xs font-medium text-destructive">🚫 محظور: {c.banReason}</p>
          )}
          {suspended && (
            <p className="text-xs font-medium text-warning">
              ⏸️ موقوف لحد {new Date(c.suspendedUntil!).toLocaleString('ar-EG')} — {c.suspendReason}
            </p>
          )}
          {c.rejectedProofs > 0 && (
            <p className="text-xs text-destructive">⚠️ {c.rejectedProofs} إيصال مرفوض</p>
          )}
        </CardContent>
      </Card>

      {c.wholesaleAt && wallet.data && (
        <Card>
          <CardContent className="flex items-center justify-between p-4 text-sm">
            <span className="text-muted-foreground">💳 رصيد المحفظة</span>
            <span className="text-lg font-bold tabular-nums" dir="ltr">
              {formatMoney(wallet.data.balance, wallet.data.currency)}
            </span>
          </CardContent>
        </Card>
      )}

      {notice && <p className="rounded-lg bg-success/10 p-3 text-sm text-success">{notice}</p>}

      <div className="grid grid-cols-2 gap-2">
        {staffCan('customers.write') && (
          <Button
            variant={panel === 'message' ? 'default' : 'outline'}
            onClick={() => open('message')}
          >
            ✉️ رسالة
          </Button>
        )}
        {staffCan('wallet.adjust') && c.wholesaleAt && (
          <Button
            variant={panel === 'wallet' ? 'default' : 'outline'}
            onClick={() => open('wallet')}
          >
            💳 تعديل الرصيد
          </Button>
        )}
        {staffCan('customers.ban') &&
          (suspended ? (
            <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate('lift')}>
              ▶️ رفع الإيقاف
            </Button>
          ) : (
            c.status !== 'BANNED' && (
              <Button
                variant={panel === 'suspend' ? 'default' : 'outline'}
                onClick={() => open('suspend')}
              >
                ⏸️ إيقاف مؤقت
              </Button>
            )
          ))}
        {staffCan('customers.ban') &&
          (c.status === 'BANNED' ? (
            <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate('unban')}>
              ✅ رفع الحظر
            </Button>
          ) : (
            <Button
              variant={panel === 'ban' ? 'destructive' : 'outline'}
              className={panel === 'ban' ? '' : 'text-destructive'}
              onClick={() => open('ban')}
            >
              🚫 حظر
            </Button>
          ))}
      </div>

      {panel && (
        <Card>
          <CardContent className="space-y-2 p-4">
            {panel === 'suspend' && (
              <div className="flex gap-1.5">
                {[1, 6, 24, 72].map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setHours(h)}
                    className={`flex-1 rounded-lg border py-1.5 text-xs ${hours === h ? 'border-primary bg-primary/10' : ''}`}
                  >
                    {h < 24 ? `${h} س` : `${h / 24} يوم`}
                  </button>
                ))}
              </div>
            )}
            {panel === 'wallet' && (
              <Input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="المبلغ (+ للإضافة، − للخصم)"
                dir="ltr"
              />
            )}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={panel === 'message' ? 4 : 2}
              className="w-full rounded-md border bg-background p-2 text-sm"
              placeholder={
                panel === 'message'
                  ? 'الرسالة اللي هتوصل من البوت'
                  : panel === 'wallet'
                    ? 'السبب (التاجر بيشوفه)'
                    : 'السبب (بيوصل للعميل)'
              }
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button
              className="w-full"
              variant={panel === 'ban' ? 'destructive' : 'default'}
              disabled={
                act.isPending ||
                (panel === 'message' && text.trim().length < 1) ||
                (panel === 'wallet' && (!Number(amount) || text.trim().length < 2))
              }
              onClick={() => act.mutate(panel)}
            >
              {act.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {panel === 'message'
                ? 'ابعت'
                : panel === 'suspend'
                  ? `أوقفه ${hours} ساعة`
                  : panel === 'ban'
                    ? 'احظره نهائي'
                    : 'نفّذ'}
            </Button>
            {panel === 'ban' && (
              <p className="text-[11px] text-muted-foreground">
                الحظر بيلغي طلباته اللي مش مدفوعة ويرفض إيصالاته المستنية.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {c.orders.length > 0 && (
        <Card>
          <CardContent className="divide-y p-0">
            {c.orders.map((o) => (
              <Link
                key={o.id}
                href={`/admin/orders/${o.id}`}
                className="flex items-center justify-between p-3 text-sm"
              >
                <span>
                  #{o.sequenceNumber}{' '}
                  <span className="text-xs text-muted-foreground">· {formatDate(o.createdAt)}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {ORDER_STATUS_LABELS_AR[o.status as OrderStatus] ?? o.status} ·{' '}
                  <span dir="ltr">{Number(o.total).toFixed(2)}</span>
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {c.strikes.length > 0 && (
        <Card>
          <CardContent className="space-y-1 p-4 text-xs">
            <p className="text-sm font-medium">🛡️ المخالفات</p>
            {c.strikes.map((s) => (
              <p key={s.id} className="text-muted-foreground">
                {formatDate(s.createdAt)} · {s.reason} · {s.action === 'BAN' ? 'حظر' : 'إيقاف'}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
