import Link from 'next/link';
import { Badge, Card, CardContent } from '@sqlm/ui';
import { formatMoney } from '@/lib/format';
import type { Product } from '@/types/api';

export function ProductCard({ product }: { product: Product }) {
  const outOfStock = product.availableStock <= 0;

  return (
    <Link href={`/products/${product.slug}`}>
      <Card className="overflow-hidden transition hover:border-primary/50">
        <div className="relative aspect-square w-full bg-muted">
          {product.images[0] ? (
            // eslint-disable-next-line @next/next/no-img-element -- images come from admin-configured, arbitrary storage hosts
            <img
              src={product.images[0]}
              alt={product.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              لا توجد صورة
            </div>
          )}
          {product.featured && (
            <Badge variant="warning" className="absolute start-2 top-2">
              عرض
            </Badge>
          )}
          {outOfStock && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 text-xs font-medium">
              نفدت الكمية
            </div>
          )}
        </div>
        <CardContent className="space-y-1 p-3">
          <p className="line-clamp-1 text-sm font-medium">{product.name}</p>
          {product.shortDescription && (
            <p className="line-clamp-1 text-xs text-muted-foreground">{product.shortDescription}</p>
          )}
          <div className="flex items-baseline gap-2 pt-1">
            <span className="text-sm font-semibold">
              {formatMoney(product.price, product.currency)}
            </span>
            {product.compareAtPrice && Number(product.compareAtPrice) > Number(product.price) && (
              <span className="text-xs text-muted-foreground line-through">
                {formatMoney(product.compareAtPrice, product.currency)}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
