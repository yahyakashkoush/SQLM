'use client';

import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import { useOrders } from '@/lib/queries';

const BOUGHT = ['PAID', 'PROCESSING', 'READY_FOR_DELIVERY', 'DELIVERED', 'COMPLETED'];

/** Products this customer already paid for, newest first — subscriptions get renewed. */
export function BuyAgain() {
  const { data } = useOrders();
  const seen = new Set<string>();
  const products: Array<{ slug: string; name: string; image?: string }> = [];
  for (const order of data?.items ?? []) {
    if (!BOUGHT.includes(order.status)) continue;
    for (const item of order.items) {
      const product = item.product;
      if (
        !product ||
        seen.has(product.slug) ||
        product.status !== 'ACTIVE' ||
        product.visibility !== 'VISIBLE'
      )
        continue;
      seen.add(product.slug);
      products.push({
        slug: product.slug,
        name: item.productNameSnapshot,
        image: product.images[0],
      });
    }
  }
  if (products.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <RotateCcw className="h-4 w-4" /> اطلب تاني
      </h2>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {products.slice(0, 8).map((p) => (
          <Link
            key={p.slug}
            href={`/products/${p.slug}`}
            className="flex w-36 shrink-0 items-center gap-2 rounded-xl border bg-card p-2"
          >
            <span className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-muted">
              {p.image && (
                // eslint-disable-next-line @next/next/no-img-element -- admin-configured storage host
                <img src={p.image} alt="" className="h-full w-full object-cover" />
              )}
            </span>
            <span className="line-clamp-2 text-xs font-medium leading-tight">{p.name}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
