'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Loader2, Minus, Plus, Search } from 'lucide-react';
import { Card, CardContent, Input } from '@sqlm/ui';
import { ApiError } from '@/lib/api';
import { adminApi, staffCan, type ProductRow } from '@/lib/admin-api';
import { formatMoney } from '@/lib/format';
import { AdminTitle, Empty, ListSkeleton } from '@/components/admin/admin-ui';

export default function AdminProductsPage() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const qs = new URLSearchParams({
    pageSize: '50',
    ...(query ? { search: query } : {}),
  }).toString();
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'products', qs],
    queryFn: () => adminApi.products(qs),
  });
  const items = (data?.items ?? []).filter((p) => p.status !== 'ARCHIVED');

  return (
    <>
      <AdminTitle
        title="المنتجات"
        hint="تحكم سريع في المخزون والظهور. الأسعار والباقات والتفاصيل من لوحة التحكم على الموقع."
      />
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(search.trim());
        }}
      >
        <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="اسم المنتج"
          className="ps-9"
        />
      </form>
      {isLoading ? (
        <ListSkeleton />
      ) : !items.length ? (
        <Empty>مفيش منتجات.</Empty>
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {items
              .sort((a, b) => a.availableStock - b.availableStock)
              .map((p) => (
                <ProductLine key={p.id} product={p} />
              ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}

function ProductLine({ product: p }: { product: ProductRow }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'products'] });
  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : 'حصل خطأ');
  const stock = useMutation({
    mutationFn: (delta: number) => adminApi.adjustStock(p.id, delta),
    onSuccess: refresh,
    onError,
  });
  const visibility = useMutation({
    mutationFn: () =>
      adminApi.updateProduct(p.id, {
        visibility: p.visibility === 'VISIBLE' ? 'HIDDEN' : 'VISIBLE',
      }),
    onSuccess: refresh,
    onError,
  });
  const low = p.availableStock <= 3;
  const visible = p.visibility === 'VISIBLE' && p.status === 'ACTIVE';

  return (
    <div className={`flex items-center gap-3 p-3 text-sm ${visible ? '' : 'opacity-60'}`}>
      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-muted">
        {p.images[0] && (
          // eslint-disable-next-line @next/next/no-img-element -- admin-configured storage host
          <img src={p.images[0]} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{p.name}</p>
        <p className="text-xs text-muted-foreground">
          <span dir="ltr">{formatMoney(p.price, p.currency)}</span>
          {' · '}
          <span className={low ? 'font-semibold text-destructive' : ''}>
            متاح {p.availableStock}
          </span>
        </p>
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>
      {staffCan('inventory.write') && p.inventoryMode === 'QUANTITY' && (
        <div className="flex items-center rounded-lg border">
          <button
            type="button"
            className="p-1.5"
            aria-label="نقّص"
            disabled={stock.isPending || p.stock <= 0}
            onClick={() => stock.mutate(-1)}
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-7 text-center text-xs tabular-nums">
            {stock.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : p.stock}
          </span>
          <button
            type="button"
            className="p-1.5"
            aria-label="زوّد"
            disabled={stock.isPending}
            onClick={() => stock.mutate(1)}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      )}
      {staffCan('products.write') && (
        <button
          type="button"
          className="rounded-lg border p-2"
          aria-label={p.visibility === 'VISIBLE' ? 'إخفاء' : 'إظهار'}
          disabled={visibility.isPending}
          onClick={() => visibility.mutate()}
        >
          {p.visibility === 'VISIBLE' ? (
            <Eye className="h-4 w-4" />
          ) : (
            <EyeOff className="h-4 w-4" />
          )}
        </button>
      )}
    </div>
  );
}
