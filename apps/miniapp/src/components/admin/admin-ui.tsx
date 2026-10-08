'use client';

import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Skeleton } from '@sqlm/ui';

export function AdminTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="space-y-0.5">
      <h1 className="text-lg font-semibold">{title}</h1>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs ${value === o.value ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full rounded-xl" />
      ))}
    </div>
  );
}

/** A receipt behind a short-lived signed URL: images inline, PDFs as a link. */
export function Receipt({
  queryKey,
  load,
}: {
  queryKey: unknown[];
  load: () => Promise<{ url: string; mimeType?: string }>;
}) {
  const { data, isError } = useQuery({ queryKey, queryFn: load, staleTime: 10 * 60_000 });
  if (isError) return <p className="text-xs text-destructive">مقدرناش نفتح الإيصال.</p>;
  if (!data) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> بيحمّل الإيصال…
      </p>
    );
  }
  if (data.mimeType && !data.mimeType.startsWith('image/')) {
    return (
      <a
        href={data.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-sm text-primary underline"
      >
        <ExternalLink className="h-4 w-4" /> افتح الإيصال (PDF)
      </a>
    );
  }
  return (
    <a
      href={data.url}
      target="_blank"
      rel="noreferrer"
      className="block overflow-hidden rounded-lg border bg-muted"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
      <img src={data.url} alt="إيصال التحويل" className="max-h-80 w-full object-contain" />
    </a>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'good' | 'bad';
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={`mt-0.5 text-lg font-bold tabular-nums ${tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-destructive' : ''}`}
        dir="ltr"
      >
        {value}
      </p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

export const customerName = (c: {
  fullName?: string | null;
  firstName: string | null;
  lastName?: string | null;
  telegramUsername: string | null;
}) =>
  c.fullName ||
  [c.firstName, c.lastName].filter(Boolean).join(' ') ||
  (c.telegramUsername ? `@${c.telegramUsername}` : 'عميل');
