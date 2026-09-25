'use client';

import Link from 'next/link';
import { Card, Skeleton } from '@sqlm/ui';
import { useCategories } from '@/lib/queries';

export default function CategoriesPage() {
  const categories = useCategories();

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">Categories</h1>
      {categories.isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : categories.data?.length ? (
        <div className="grid grid-cols-2 gap-3">
          {categories.data.map((c) => (
            <Link key={c.id} href={`/products?category=${c.slug}`}>
              <Card className="flex h-24 flex-col items-center justify-center gap-1 p-3 text-center">
                {c.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- admin-configured storage host
                  <img src={c.image} alt="" className="h-8 w-8 rounded object-cover" />
                ) : null}
                <span className="text-sm font-medium">{c.name}</span>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No categories yet.</p>
      )}
    </main>
  );
}
