'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Card, CardContent, Input } from '@sqlm/ui';
import { api, type ProfitFigures, type ProfitReport } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));

const PRESETS = [
  { label: 'Today', from: () => daysAgo(0) },
  { label: '7 days', from: () => daysAgo(6) },
  { label: '30 days', from: () => daysAgo(29) },
  { label: '90 days', from: () => daysAgo(89) },
  {
    label: 'This month',
    from: () => iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
  },
] as const;

const fmt = (v: string | number) =>
  Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ProfitsPage() {
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(daysAgo(0));
  const { data, isLoading, error } = useQuery({
    queryKey: ['profits', from, to],
    queryFn: () => api.profits(from, to),
  });

  return (
    <>
      <PageHeader
        title="Profits"
        description="What came in, what it cost, and what you kept — after discounts, by the day it was paid. Cost uses the cost price set on each product when the order was placed."
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1">
          {PRESETS.map((p) => {
            const active = from === p.from() && to === daysAgo(0);
            return (
              <button
                key={p.label}
                onClick={() => (setFrom(p.from()), setTo(daysAgo(0)))}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${active ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5 text-sm">
          <Input
            type="date"
            value={from}
            max={to}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
            className="w-auto"
          />
          <span className="text-muted-foreground">→</span>
          <Input
            type="date"
            value={to}
            min={from}
            max={daysAgo(0)}
            onChange={(e) => e.target.value && setTo(e.target.value)}
            className="w-auto"
          />
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : 'Could not load the report'}
        </p>
      ) : isLoading || !data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Report data={data} />
      )}
    </>
  );
}

function Report({ data }: { data: ProfitReport }) {
  const { totals, currency } = data;
  return (
    <div className="space-y-6">
      {totals.costCoverage < 100 && totals.units > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p>
            Only {totals.costCoverage}% of units sold have a cost price, so profit is overstated.
            Set{' '}
            <Link href="/products" className="underline">
              Cost price
            </Link>{' '}
            on each product — new orders will use it.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Revenue"
          value={fmt(totals.revenue)}
          unit={currency}
          sub={`${totals.orders} orders · ${totals.units} units`}
        />
        <Tile
          label="Cost"
          value={fmt(totals.cost)}
          unit={currency}
          sub={`avg order ${fmt(totals.averageOrder)}`}
        />
        <Tile
          label="Profit"
          value={fmt(totals.profit)}
          unit={currency}
          sub={totals.margin === null ? '—' : `${totals.margin}% margin`}
          tone={Number(totals.profit) < 0 ? 'bad' : 'good'}
        />
        <Tile
          label="Merchant balances"
          value={fmt(totals.walletLiability)}
          unit={currency}
          sub="prepaid, not yet spent"
        />
      </div>
      {(totals.refunds.count > 0 || totals.otherCurrencyOrders > 0) && (
        <p className="text-xs text-muted-foreground">
          {totals.refunds.count > 0 &&
            `${totals.refunds.count} refunded order(s) worth ${fmt(totals.refunds.amount)} ${currency} are excluded. `}
          {totals.otherCurrencyOrders > 0 &&
            `${totals.otherCurrencyOrders} order(s) in another currency are not counted.`}
        </p>
      )}

      <Card>
        <CardContent className="p-4">
          <p className="mb-1 text-sm font-medium">Profit per day</p>
          <p className="mb-3 text-xs text-muted-foreground">
            Hover a day for revenue, cost and orders.
          </p>
          <DailyChart days={data.daily} currency={currency} />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.5fr,1fr] [&>*]:min-w-0">
        <Card>
          <CardContent className="p-4">
            <p className="mb-3 text-sm font-medium">Products by profit</p>
            <FigureTable
              rows={data.products.map((p) => ({ ...p, key: p.id, href: undefined }))}
              empty="No paid orders in this range."
              showUnits
            />
          </CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardContent className="p-4">
              <p className="mb-3 text-sm font-medium">Top customers</p>
              <FigureTable
                rows={data.customers.map((c) => ({
                  ...c,
                  key: c.id,
                  name: `${c.merchant ? '🏪 ' : ''}${c.name}`,
                  href: `/customers/${c.id}`,
                }))}
                empty="No customers yet."
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="mb-3 text-sm font-medium">By payment channel</p>
              <ShareBars rows={data.channels} total={Number(totals.revenue)} currency={currency} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  unit,
  sub,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  sub: string;
  tone?: 'good' | 'bad';
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={`mt-1 text-xl font-semibold tabular-nums sm:text-2xl ${tone === 'bad' ? 'text-destructive' : tone === 'good' ? 'text-success' : ''}`}
        >
          {value} <span className="text-xs font-normal text-muted-foreground">{unit}</span>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

/** One series (profit) as bars from a zero baseline; losses hang below it. */
function DailyChart({ days, currency }: { days: ProfitReport['daily']; currency: string }) {
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at its real on-screen width, so axis labels stay 10px on a phone
  // instead of shrinking with a scaled-down viewBox.
  const [W, setW] = useState(720);
  const observer = useRef<ResizeObserver | null>(null);
  const box = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!el) return;
    observer.current = new ResizeObserver(([entry]) =>
      setW(Math.max(280, Math.round(entry!.contentRect.width))),
    );
    observer.current.observe(el);
  }, []);
  const H = 220;
  const pad = { top: 12, right: 8, bottom: 24, left: 52 };
  const values = days.map((d) => Number(d.profit));
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const y = (v: number) => pad.top + ((max - v) / span) * innerH;
  const slot = innerW / days.length;
  const barW = Math.max(1, Math.min(28, slot - 2));
  const ticks = useMemo(() => {
    const step = niceStep(span / 4);
    const out: number[] = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step)
      out.push(Number(v.toFixed(6)));
    return out;
  }, [min, max, span]);
  const labelEvery = Math.ceil(days.length / Math.max(3, Math.floor(innerW / 64)));
  const active = hover !== null ? days[hover] : null;

  if (days.every((d) => d.orders === 0)) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No paid orders in this range.
      </p>
    );
  }

  return (
    <div className="relative" ref={box}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Profit per day"
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={pad.left}
              x2={W - pad.right}
              y1={y(t)}
              y2={y(t)}
              className={t === 0 ? 'stroke-border' : 'stroke-border/50'}
              strokeWidth={1}
            />
            <text
              x={pad.left - 6}
              y={y(t)}
              dy="0.32em"
              textAnchor="end"
              className="fill-muted-foreground text-[10px] tabular-nums"
            >
              {compact(t)}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const v = Number(d.profit);
          const x = pad.left + i * slot + (slot - barW) / 2;
          const top = Math.min(y(v), y(0));
          const h = Math.max(v === 0 ? 0 : 1, Math.abs(y(v) - y(0)));
          return (
            <g key={d.date}>
              <rect
                x={x}
                y={top}
                width={barW}
                height={h}
                rx={Math.min(4, barW / 2)}
                className={v < 0 ? 'fill-destructive' : 'fill-primary'}
                opacity={hover === null || hover === i ? 1 : 0.45}
              />
              {/* Hit target: the whole column, bigger than the bar. */}
              <rect
                x={pad.left + i * slot}
                y={pad.top}
                width={slot}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onClick={() => setHover(i)}
              />
              {i % labelEvery === 0 && (
                <text
                  x={pad.left + i * slot + slot / 2}
                  y={H - 6}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  {d.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {active && hover !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 w-44 rounded-md border bg-popover p-2 text-xs shadow-md"
          style={{
            left: `clamp(0px, calc(${((pad.left + hover * slot + slot / 2) / W) * 100}% - 5.5rem), calc(100% - 11rem))`,
          }}
        >
          <p className="font-medium">
            {new Date(`${active.date}T00:00:00Z`).toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              timeZone: 'UTC',
            })}
          </p>
          <Row k="Revenue" v={`${fmt(active.revenue)} ${currency}`} />
          <Row k="Cost" v={fmt(active.cost)} />
          <Row k="Profit" v={fmt(active.profit)} strong />
          <Row k="Orders" v={String(active.orders)} />
        </div>
      )}
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <p className="flex justify-between gap-2 tabular-nums">
      <span className="text-muted-foreground">{k}</span>
      <span className={strong ? 'font-semibold' : ''}>{v}</span>
    </p>
  );
}

function FigureTable({
  rows,
  empty,
  showUnits,
}: {
  rows: Array<ProfitFigures & { key: string; name: string; href?: string }>;
  empty: string;
  showUnits?: boolean;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[26rem] text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="pb-2 font-normal">Name</th>
            {showUnits && <th className="pb-2 text-right font-normal">Units</th>}
            <th className="pb-2 text-right font-normal">Revenue</th>
            <th className="pb-2 text-right font-normal">Profit</th>
            <th className="pb-2 text-right font-normal">Margin</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="max-w-[14rem] truncate py-2" dir="auto">
                {r.href ? (
                  <Link href={r.href} className="hover:underline">
                    {r.name}
                  </Link>
                ) : (
                  r.name
                )}
              </td>
              {showUnits && <td className="text-right tabular-nums">{r.units}</td>}
              <td className="text-right tabular-nums">{fmt(r.revenue)}</td>
              <td
                className={`text-right tabular-nums ${Number(r.profit) < 0 ? 'text-destructive' : ''}`}
              >
                {fmt(r.profit)}
              </td>
              <td className="text-right tabular-nums text-muted-foreground">
                {r.margin === null ? '—' : `${r.margin}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ShareBars({
  rows,
  total,
  currency,
}: {
  rows: ProfitReport['channels'];
  total: number;
  currency: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nothing yet.</p>;
  return (
    <ul className="space-y-3 text-sm">
      {rows.map((r) => {
        const share = total > 0 ? (Number(r.revenue) / total) * 100 : 0;
        return (
          <li key={r.name}>
            <div className="flex justify-between gap-2">
              <span dir="auto">{r.name}</span>
              <span className="tabular-nums text-muted-foreground">
                {fmt(r.revenue)} {currency} · {Math.round(share)}%
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-muted">
              <div
                className="h-1.5 rounded-full bg-primary"
                style={{ width: `${Math.max(share, 1)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function niceStep(raw: number) {
  const exp = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const f = raw / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

function compact(v: number) {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (a >= 1000) return `${(v / 1000).toFixed(a >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(v * 100) / 100);
}
