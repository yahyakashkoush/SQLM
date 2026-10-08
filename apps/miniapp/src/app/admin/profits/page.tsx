'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, Skeleton } from '@sqlm/ui';
import { adminApi } from '@/lib/admin-api';
import { formatMoney } from '@/lib/format';
import { AdminTitle, Stat, Tabs } from '@/components/admin/admin-ui';

const day = (offset: number) =>
  new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
const RANGES = [
  { value: '0', label: 'النهارده' },
  { value: '6', label: '7 أيام' },
  { value: '29', label: '30 يوم' },
  { value: '89', label: '90 يوم' },
] as const;

export default function AdminProfitsPage() {
  const [range, setRange] = useState<(typeof RANGES)[number]['value']>('6');
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'profits', range],
    queryFn: () => adminApi.profits(day(Number(range)), day(0)),
  });

  return (
    <>
      <AdminTitle title="الأرباح" hint="الإيراد بعد الخصومات، والتكلفة من سعر التكلفة وقت البيع." />
      <Tabs value={range} onChange={setRange} options={RANGES} />
      {isLoading || !data ? (
        <Skeleton className="h-60 w-full rounded-xl" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat
              label="الإيراد"
              value={formatMoney(data.totals.revenue, data.currency)}
              sub={`${data.totals.orders} طلب · ${data.totals.units} وحدة`}
            />
            <Stat
              label="صافي الربح"
              value={formatMoney(data.totals.profit, data.currency)}
              sub={data.totals.margin === null ? undefined : `هامش ${data.totals.margin}%`}
              tone={Number(data.totals.profit) < 0 ? 'bad' : 'good'}
            />
            <Stat
              label="التكلفة"
              value={formatMoney(data.totals.cost, data.currency)}
              sub={`متوسط الطلب ${formatMoney(data.totals.averageOrder, data.currency)}`}
            />
            <Stat
              label="أرصدة التجار"
              value={formatMoney(data.totals.walletLiability, data.currency)}
              sub="مدفوعة ولسه ما اتصرفتش"
            />
          </div>
          {data.totals.costCoverage < 100 && data.totals.units > 0 && (
            <p className="rounded-lg bg-warning/10 p-2 text-xs">
              ⚠️ {100 - data.totals.costCoverage}% من الوحدات المبيعة مالهاش سعر تكلفة — الربح
              الحقيقي أقل. حط سعر التكلفة لكل منتج.
            </p>
          )}

          {data.daily.length > 1 && <ProfitBars days={data.daily} />}

          <Card>
            <CardContent className="p-0">
              <p className="border-b p-3 text-sm font-medium">أكتر المنتجات ربحاً</p>
              {data.products.length === 0 ? (
                <p className="p-4 text-center text-xs text-muted-foreground">
                  مفيش مبيعات في الفترة دي.
                </p>
              ) : (
                <div className="divide-y">
                  {data.products.slice(0, 10).map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate">{p.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.units} وحدة · إيراد{' '}
                          <span dir="ltr">{Number(p.revenue).toFixed(2)}</span>
                        </p>
                      </div>
                      <div className="text-end">
                        <p
                          className={`font-semibold tabular-nums ${Number(p.profit) < 0 ? 'text-destructive' : ''}`}
                          dir="ltr"
                        >
                          {Number(p.profit).toFixed(2)}
                        </p>
                        {p.margin !== null && (
                          <p className="text-[11px] text-muted-foreground">{p.margin}%</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {data.channels.length > 0 && (
            <Card>
              <CardContent className="space-y-3 p-3">
                <p className="text-sm font-medium">طرق الدفع</p>
                {data.channels.map((c) => {
                  const share =
                    Number(data.totals.revenue) > 0
                      ? (Number(c.revenue) / Number(data.totals.revenue)) * 100
                      : 0;
                  return (
                    <div key={c.name} className="text-xs">
                      <div className="flex justify-between">
                        <span>
                          {c.name === 'Wallet'
                            ? 'رصيد المحفظة'
                            : c.name === 'Gifts'
                              ? 'هدايا'
                              : c.name}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {Math.round(share)}%
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-muted">
                        <div
                          className="h-1.5 rounded-full bg-primary"
                          style={{ width: `${Math.max(share, 2)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </>
  );
}

/** Profit per day, one bar each; tap a bar for that day's numbers. */
function ProfitBars({
  days,
}: {
  days: Array<{ date: string; profit: string; revenue: string; orders: number }>;
}) {
  const [active, setActive] = useState<number | null>(null);
  const values = days.map((d) => Number(d.profit));
  const max = Math.max(...values.map(Math.abs), 1);
  const pick = active ?? days.length - 1;
  const d = days[pick]!;
  return (
    <Card>
      <CardContent className="space-y-2 p-3">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-medium">الربح اليومي</span>
          <span className="text-muted-foreground">
            {new Date(`${d.date}T00:00:00Z`).toLocaleDateString('ar-EG', {
              day: 'numeric',
              month: 'short',
              timeZone: 'UTC',
            })}{' '}
            ·{' '}
            <span className="font-semibold text-foreground" dir="ltr">
              {Number(d.profit).toFixed(2)}
            </span>{' '}
            · {d.orders} طلب
          </span>
        </div>
        <div className="flex h-28 items-end gap-0.5" dir="ltr">
          {days.map((x, i) => {
            const v = values[i]!;
            return (
              <button
                key={x.date}
                type="button"
                aria-label={x.date}
                onClick={() => setActive(i)}
                className="flex h-full flex-1 items-end"
              >
                <span
                  className={`w-full rounded-t-[3px] ${v < 0 ? 'bg-destructive' : 'bg-primary'} ${i === pick ? '' : 'opacity-50'}`}
                  style={{ height: `${Math.max((Math.abs(v) / max) * 100, v === 0 ? 0 : 3)}%` }}
                />
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
