'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingCart } from 'lucide-react';
import { Badge, Button, Separator, Skeleton } from '@sqlm/ui';
import { useProduct } from '@/lib/queries';
import { useCartStore } from '@/store/cart-store';
import { formatMoney } from '@/lib/format';

const DELIVERY_LABEL: Record<string, string> = {
  AUTOMATIC: 'Delivered automatically',
  MANUAL: 'Delivered manually by our team',
  LICENSE_KEY: 'License key',
  ACCOUNT: 'Account credentials',
  VOUCHER: 'Voucher code',
  CODE: 'Redeem code',
  CUSTOM: 'Custom delivery',
};

export default function ProductDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const { data: product, isLoading } = useProduct(slug);
  const addItem = useCartStore((s) => s.addItem);
  const [quantity, setQuantity] = useState(1);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (isLoading) {
    return (
      <main className="flex flex-col gap-4 p-4">
        <Skeleton className="aspect-square w-full rounded-lg" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-1/2" />
      </main>
    );
  }

  if (!product) {
    return (
      <main className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-muted-foreground">Product not found.</p>
        <Button variant="outline" onClick={() => router.push('/products')}>
          Back to products
        </Button>
      </main>
    );
  }

  const outOfStock = product.availableStock <= 0;
  const maxQuantity = Math.max(1, Math.min(product.availableStock, 50));

  const handleAdd = () => {
    const result = addItem(product, quantity);
    setFeedback(result.ok ? 'Added to cart.' : (result.error ?? 'Could not add to cart.'));
  };

  return (
    <main className="flex flex-col gap-4 pb-28">
      <div className="aspect-square w-full bg-muted">
        {product.images[0] ? (
          // eslint-disable-next-line @next/next/no-img-element -- admin-configured storage host
          <img src={product.images[0]} alt={product.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No image
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {product.featured && <Badge variant="warning">Featured</Badge>}
          <Badge variant="outline">
            {DELIVERY_LABEL[product.deliveryType] ?? product.deliveryType}
          </Badge>
          {outOfStock && <Badge variant="destructive">Out of stock</Badge>}
        </div>

        <h1 className="text-xl font-semibold">{product.name}</h1>

        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold">{formatMoney(product.price, product.currency)}</span>
          {product.compareAtPrice && (
            <span className="text-sm text-muted-foreground line-through">
              {formatMoney(product.compareAtPrice, product.currency)}
            </span>
          )}
        </div>

        {(product.duration || product.warranty) && (
          <div className="flex gap-4 text-xs text-muted-foreground">
            {product.duration && <span>Duration: {product.duration}</span>}
            {product.warranty && <span>Warranty: {product.warranty}</span>}
          </div>
        )}

        <Separator />

        {product.description && (
          <p className="whitespace-pre-line text-sm text-muted-foreground">{product.description}</p>
        )}

        {!outOfStock && (
          <p className="text-xs text-muted-foreground">{product.availableStock} in stock</p>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-16 z-40 border-t bg-background p-3">
        {feedback && <p className="mb-2 text-center text-xs text-muted-foreground">{feedback}</p>}
        <div className="flex items-center gap-3">
          {!outOfStock && (
            <div className="flex items-center rounded-md border">
              <button
                type="button"
                className="px-3 py-2 text-sm disabled:opacity-40"
                disabled={quantity <= 1}
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              >
                −
              </button>
              <span className="w-8 text-center text-sm">{quantity}</span>
              <button
                type="button"
                className="px-3 py-2 text-sm disabled:opacity-40"
                disabled={quantity >= maxQuantity}
                onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
              >
                +
              </button>
            </div>
          )}
          <Button className="flex-1" size="lg" disabled={outOfStock} onClick={handleAdd}>
            <ShoppingCart className="h-4 w-4" />
            {outOfStock ? 'Out of stock' : 'Add to cart'}
          </Button>
        </div>
      </div>
    </main>
  );
}
