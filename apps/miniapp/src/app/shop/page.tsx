'use client';

import Link from 'next/link';
import { ChevronRight, Search } from 'lucide-react';
import { Badge, Skeleton } from '@sqlm/ui';
import { useCategories, useProducts } from '@/lib/queries';
import { useTelegram } from '@/components/providers/telegram-provider';
import { useAuthStore } from '@/store/auth-store';
import { ProductCard } from '@/components/products/product-card';
import { CartButton } from '@/components/cart/cart-button';

export default function ShopPage() {
  const { authError, inTelegram } = useTelegram();
  const customer = useAuthStore((s) => s.customer);
  const categories = useCategories();
  const featured = useProducts({ featured: true });

  return (
    <main className="flex flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Welcome{customer?.firstName ? `, ${customer.firstName}` : ''}
          </p>
          <h1 className="text-xl font-semibold">SQLM Store</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/products" className="rounded-full border p-2" aria-label="Search products">
            <Search className="h-5 w-5" />
          </Link>
          <CartButton />
        </div>
      </header>

      {!inTelegram && (
        <p className="rounded-md border border-warning/50 bg-warning/10 p-3 text-xs text-warning-foreground">
          Open this app inside Telegram to sign in and check out.
        </p>
      )}
      {authError && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
          {authError}
        </p>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Categories</h2>
          <Link href="/categories" className="flex items-center text-xs text-muted-foreground">
            See all <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
        {categories.isLoading ? (
          <div className="flex gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-20 shrink-0 rounded-full" />
            ))}
          </div>
        ) : categories.data?.length ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {categories.data.map((c) => (
              <Link key={c.id} href={`/products?category=${c.slug}`}>
                <Badge variant="secondary" className="whitespace-nowrap px-3 py-1.5">
                  {c.name}
                </Badge>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No categories yet.</p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Featured</h2>
          <Link href="/products" className="flex items-center text-xs text-muted-foreground">
            See all <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
        {featured.isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[3/4] w-full rounded-lg" />
            ))}
          </div>
        ) : featured.data?.items.length ? (
          <div className="grid grid-cols-2 gap-3">
            {featured.data.items.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No featured products right now.</p>
        )}
      </section>
    </main>
  );
}
