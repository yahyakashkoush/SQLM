'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { Input, Skeleton } from '@sqlm/ui';
import { useProducts } from '@/lib/queries';
import { ProductCard } from '@/components/products/product-card';
import { CartButton } from '@/components/cart/cart-button';

function ProductsGrid() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const category = searchParams.get('category') ?? undefined;
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [debouncedSearch, setDebouncedSearch] = useState(search);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const products = useProducts({ category, search: debouncedSearch || undefined });

  return (
    <main className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">
          {category ? `Products in "${category}"` : 'All products'}
        </h1>
        <CartButton />
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products..."
          className="pl-9"
        />
      </div>

      {category && (
        <button
          onClick={() => router.push('/products')}
          className="w-fit text-xs text-primary underline-offset-2 hover:underline"
        >
          Clear category filter
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
        <p className="text-sm text-muted-foreground">No products found.</p>
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
