'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { Button, Card, CardContent } from '@sqlm/ui';
import { cartSubtotal, useCartStore } from '@/store/cart-store';
import { formatMoney } from '@/lib/format';

export default function CartPage() {
  const router = useRouter();
  const items = useCartStore((s) => s.items);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const removeItem = useCartStore((s) => s.removeItem);

  if (items.length === 0) {
    return (
      <main className="flex flex-col items-center gap-3 p-8 text-center">
        <ShoppingCart className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Your cart is empty.</p>
        <Button onClick={() => router.push('/products')}>Browse products</Button>
      </main>
    );
  }

  const subtotal = cartSubtotal(items);
  const currency = items[0]!.currency;

  return (
    <main className="flex flex-col gap-4 p-4 pb-32">
      <h1 className="text-lg font-semibold">Your Cart</h1>

      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <Card key={item.productId}>
            <CardContent className="flex gap-3 p-3">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
                {item.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- admin-configured storage host
                  <img src={item.image} alt={item.name} className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="flex flex-1 flex-col justify-between">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/products/${item.slug}`} className="text-sm font-medium">
                    {item.name}
                  </Link>
                  <button
                    type="button"
                    onClick={() => removeItem(item.productId)}
                    aria-label="Remove item"
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">
                    {formatMoney(item.price, item.currency)}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded-md border p-1 disabled:opacity-40"
                      disabled={item.quantity <= 1}
                      onClick={() => setQuantity(item.productId, item.quantity - 1)}
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="w-6 text-center text-sm">{item.quantity}</span>
                    <button
                      type="button"
                      className="rounded-md border p-1 disabled:opacity-40"
                      disabled={item.quantity >= item.availableStock}
                      onClick={() => setQuantity(item.productId, item.quantity + 1)}
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="fixed inset-x-0 bottom-16 z-40 border-t bg-background p-4">
        <div className="mb-3 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="font-semibold">{formatMoney(subtotal, currency)}</span>
        </div>
        <Button className="w-full" size="lg" onClick={() => router.push('/checkout')}>
          Checkout
        </Button>
      </div>
    </main>
  );
}
