'use client';

import Link from 'next/link';
import { ShoppingCart } from 'lucide-react';
import { useCartStore } from '@/store/cart-store';

export function CartButton() {
  const count = useCartStore((s) => s.items.reduce((sum, item) => sum + item.quantity, 0));

  return (
    <Link href="/cart" className="relative rounded-full border p-2" aria-label="View cart">
      <ShoppingCart className="h-5 w-5" />
      {count > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
          {count}
        </span>
      )}
    </Link>
  );
}
