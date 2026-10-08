'use client';

import { useMemo, useState } from 'react';
import { ArrowUpLeft, Star } from 'lucide-react';
import type { SiteData } from '@/lib/api';
import { productLink } from '@/lib/api';

const INITIAL = 12;

export function ProductCatalog({
  products,
  categories,
  botUrl,
}: Pick<SiteData, 'products' | 'categories' | 'botUrl'>) {
  const [category, setCategory] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const usedCategories = useMemo(
    () => categories.filter((c) => products.some((p) => p.categoryId === c.id)),
    [categories, products],
  );
  const filtered = category ? products.filter((p) => p.categoryId === category) : products;
  const visible = showAll ? filtered : filtered.slice(0, INITIAL);

  if (products.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed p-10 text-center text-ink-soft">
        المنتجات بتتحدث دلوقتي — شوف المتاح كله جوه البوت.
      </p>
    );
  }

  return (
    <div>
      {usedCategories.length > 1 && (
        <div className="-mx-4 mb-8 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="tablist" aria-label="الأقسام">
          <Tab active={category === null} onClick={() => setCategory(null)}>
            الكل
          </Tab>
          {usedCategories.map((c) => (
            <Tab key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>
              {c.name}
            </Tab>
          ))}
        </div>
      )}

      <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
        {visible.map((p) => (
          <li key={p.id}>
            <a href={productLink(botUrl, p.slug)} className="group block" rel="noopener">
              <div className="relative aspect-square overflow-hidden rounded-2xl bg-paper-deep">
                {p.images[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- product images live on the store's own storage host
                  <img
                    src={p.images[0]}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
                  />
                ) : (
                  <span className="flex h-full items-center justify-center font-display text-3xl font-bold text-ink/20">
                    {p.name.slice(0, 2)}
                  </span>
                )}
                {p.badge && (
                  <span className="absolute start-3 top-3 rounded-full bg-paper/95 px-2.5 py-1 text-[11px] font-semibold">
                    {p.badge}
                  </span>
                )}
              </div>
              <div className="mt-3 space-y-1">
                <h3 className="font-sans text-[15px] font-semibold leading-snug" dir="auto">
                  {p.name}
                </h3>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-soft">
                  {p.duration && <span>{p.duration}</span>}
                  {Number(p.ratingScore) > 0 && (
                    <span className="inline-flex items-center gap-0.5" aria-label={`تقييم ${Number(p.ratingScore).toFixed(1)} من 5`}>
                      <Star className="h-3 w-3 fill-saffron text-saffron" />
                      {Number(p.ratingScore).toFixed(1)}
                      {p.reviewCount > 0 && <span className="opacity-70">({p.reviewCount})</span>}
                    </span>
                  )}
                </p>
                <span className="inline-flex items-center gap-1 pt-1 text-xs font-semibold text-tg-deep">
                  اطلب من البوت
                  <ArrowUpLeft className="h-3.5 w-3.5 transition group-hover:-translate-x-0.5 group-hover:-translate-y-0.5" />
                </span>
              </div>
            </a>
          </li>
        ))}
      </ul>

      {filtered.length > INITIAL && !showAll && (
        <div className="mt-10 flex justify-center">
          <button type="button" className="btn-ghost" onClick={() => setShowAll(true)}>
            عرض كل المنتجات ({filtered.length})
          </button>
        </div>
      )}
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm transition ${
        active ? 'border-ink bg-ink text-paper' : 'border-line bg-paper hover:border-ink/40'
      }`}
    >
      {children}
    </button>
  );
}
