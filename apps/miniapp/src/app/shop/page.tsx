'use client';

import Link from 'next/link';
import { ChevronLeft, Search } from 'lucide-react';
import { Skeleton } from '@sqlm/ui';
import { useCategories, useProducts, useStoreInfo } from '@/lib/queries';
import { useTelegram } from '@/components/providers/telegram-provider';
import { useAuthStore } from '@/store/auth-store';
import { ProductCard } from '@/components/products/product-card';
import { CartButton } from '@/components/cart/cart-button';

export default function ShopPage() {
  const { authError, inTelegram } = useTelegram();
  const customer = useAuthStore((s) => s.customer);
  const store = useStoreInfo();
  const categories = useCategories();
  const featured = useProducts({ featured: true });
  const latest = useProducts({});

  return (
    <main className="flex flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">أهلاً{customer?.firstName ? ` ${customer.firstName}` : ''} 👋</p>
          <h1 className="text-xl font-semibold">{store.data?.name ?? 'المتجر'}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/products" className="rounded-full border p-2" aria-label="بحث">
            <Search className="h-5 w-5" />
          </Link>
          <CartButton />
        </div>
      </header>

      {!inTelegram && (
        <p className="rounded-md border border-warning/50 bg-warning/10 p-3 text-xs">
          افتح التطبيق من جوه تيليجرام علشان تقدر تسجل دخول وتكمل الطلب.
        </p>
      )}
      {authError && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">{authError}</p>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">الأقسام</h2>
          <Link href="/categories" className="flex items-center text-xs text-muted-foreground">
            عرض الكل <ChevronLeft className="h-3 w-3" />
          </Link>
        </div>
        {categories.isLoading ? (
          <div className="flex gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-20 shrink-0 rounded-lg" />
            ))}
          </div>
        ) : categories.data?.length ? (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {categories.data.map((c) => (
              <Link key={c.id} href={`/products?category=${c.slug}`} className="flex w-20 shrink-0 flex-col items-center gap-1">
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-muted">
                  {c.image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- admin-configured storage host
                    <img src={c.image} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-lg font-semibold text-muted-foreground">{c.name.slice(0, 1)}</span>
                  )}
                </div>
                <span className="line-clamp-2 text-center text-[11px] leading-tight">{c.name}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">لا توجد أقسام حالياً.</p>
        )}
      </section>

      {(featured.isLoading || Boolean(featured.data?.items.length)) && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">🔥 العروض</h2>
            <Link href="/products?featured=true" className="flex items-center text-xs text-muted-foreground">
              عرض الكل <ChevronLeft className="h-3 w-3" />
            </Link>
          </div>
          {featured.isLoading ? (
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="aspect-[3/4] w-full rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {featured.data!.items.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">أحدث المنتجات</h2>
          <Link href="/products" className="flex items-center text-xs text-muted-foreground">
            عرض الكل <ChevronLeft className="h-3 w-3" />
          </Link>
        </div>
        {latest.isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[3/4] w-full rounded-lg" />
            ))}
          </div>
        ) : latest.data?.items.length ? (
          <div className="grid grid-cols-2 gap-3">
            {latest.data.items.slice(0, 8).map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">لا توجد منتجات حالياً.</p>
        )}
      </section>
    </main>
  );
}
