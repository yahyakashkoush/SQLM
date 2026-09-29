'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { Input, Skeleton } from '@sqlm/ui';
import { useCategories, useProducts } from '@/lib/queries';
import { ProductCard } from '@/components/products/product-card';
import { CartButton } from '@/components/cart/cart-button';

function ProductsGrid() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const category = searchParams.get('category') ?? undefined;
  const featuredOnly = searchParams.get('featured') === 'true';
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const categories = useCategories();
  const categoryName = categories.data?.find((c) => c.slug === category)?.name;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const products = useProducts({ category, search: debouncedSearch || undefined, featured: featuredOnly || undefined });

  return (
    <main className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">
          {featuredOnly ? '🔥 العروض' : categoryName ? categoryName : 'كل المنتجات'}
        </h1>
        <CartButton />
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث عن منتج…" className="ps-9" />
      </div>

      {categories.data && categories.data.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => router.push('/products')}
            className={`shrink-0 rounded-full border px-3 py-1 text-xs ${!category && !featuredOnly ? 'border-primary bg-primary text-primary-foreground' : ''}`}
          >
            الكل
          </button>
          {categories.data.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => router.push(`/products?category=${c.slug}`)}
              className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs ${category === c.slug ? 'border-primary bg-primary text-primary-foreground' : ''}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {(category || featuredOnly) && (
        <button onClick={() => router.push('/products')} className="flex w-fit items-center gap-1 text-xs text-primary">
          <X className="h-3 w-3" /> إلغاء الفلتر
        </button>
      )}

      {products.isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[3/4] w-full rounded-lg" />
          ))}
        </div>
      ) : products.data?.items.length ? (
        <div className="grid grid-cols-2 gap-3">
          {products.data.items.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">مفيش منتجات مطابقة.</p>
      )}
    </main>
  );
}

export default function ProductsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-4 p-4">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-9 w-full" />
        </div>
      }
    >
      <ProductsGrid />
    </Suspense>
  );
}
