'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Button, Card, CardContent, Skeleton } from '@sqlm/ui';
import { api } from '@/lib/api';

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

/**
 * Revenue for a window with the window before it alongside.
 *
 * The dashboard's other revenue figure is all-time, which only ever grows
 * and so cannot answer whether the store is doing better than it was. This
 * one can.
 */
export function RevenuePanel() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useQuery({
    queryKey: ['revenue', days],
    queryFn: () => api.revenue(days),
    refetchInterval: 5 * 60_000,
  });

  const change = data?.changePercent ?? null;
  const Trend = change === null || change === 0 ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight;
  const trendClass =
    change === null || change === 0
      ? 'text-muted-foreground'
      : change > 0
        ? 'text-success'
        : 'text-destructive';

  const peak = Math.max(1, ...(data?.byDay.map((d) => Number(d.revenue)) ?? [1]));

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">Revenue</p>
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <Button
                key={r.days}
                size="sm"
                variant={days === r.days ? 'default' : 'outline'}
                onClick={() => setDays(r.days)}
              >
                {r.label}
              </Button>
            ))}
          </div>
        </div>

        {isLoading || !data ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
              <div>
                <p className="text-2xl font-semibold">{data.revenue}</p>
                <p className="text-xs text-muted-foreground">
                  {data.orders} order{data.orders === 1 ? '' : 's'}
                </p>
              </div>
              <p className={`flex items-center gap-1 text-sm ${trendClass}`}>
                <Trend className="h-4 w-4" />
                {change === null
                  ? 'no earlier period to compare'
                  : `${change > 0 ? '+' : ''}${change}% vs previous ${data.days} days`}
              </p>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
              <span>Average order: {data.averageOrderValue}</span>
              <span>Discounts given: {data.discountsGiven}</span>
              <span>Previous period: {data.previous.revenue}</span>
            </div>

            {data.byDay.length > 0 && (
              <div
                className="flex h-16 items-end gap-0.5"
                role="img"
                aria-label={`Daily revenue over the last ${data.days} days`}
              >
                {data.byDay.map((d) => (
                  <div
                    key={d.day}
                    className="min-w-[2px] flex-1 rounded-sm bg-primary/70"
                    // Floor at 2% so a day with a tiny sale is still visibly
                    // different from a day with none at all.
                    style={{ height: `${Math.max(2, (Number(d.revenue) / peak) * 100)}%` }}
                    title={`${new Date(d.day).toLocaleDateString()} — ${d.revenue} (${d.orders})`}
                  />
                ))}
              </div>
            )}

            {data.topProducts.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Top sellers</p>
                {data.topProducts.map((p) => (
                  <div key={p.productId} className="flex justify-between text-xs">
                    <span className="truncate pe-2">{p.name}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {p.units}× · {p.revenue}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
