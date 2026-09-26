'use client';

import Link from 'next/link';
import { Card, Skeleton } from '@sqlm/ui';
import { useCategories } from '@/lib/queries';

export default function CategoriesPage() {
  const categories = useCategories();

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">الأقسام</h1>
      {categories.isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      ) : categories.data?.length ? (
        <div className="grid grid-cols-2 gap-3">
          {categories.data.map((c) => (
            <Link key={c.id} href={`/products?category=${c.slug}`}>
              <Card className="flex h-28 flex-col items-center justify-center gap-2 p-3 text-center">
                {c.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- admin-configured storage host
                  <img src={c.image} alt="" className="h-12 w-12 rounded-lg object-cover" />
                ) : null}
                <span className="text-sm font-medium">{c.name}</span>
                {c.description && <span className="line-clamp-1 text-[11px] text-muted-foreground">{c.description}</span>}
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">لا توجد أقسام حالياً.</p>
      )}
    </main>
  );
}
