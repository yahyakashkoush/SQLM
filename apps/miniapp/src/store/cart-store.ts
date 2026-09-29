import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Product } from '@/types/api';

export interface CartItem {
  productId: string;
  slug: string;
  name: string;
  price: string;
  currency: string;
  image?: string;
  quantity: number;
  availableStock: number;
}

interface CartState {
  items: CartItem[];
  /** Generated once per checkout attempt and reused across retries — this is what makes a double-tap on "Pay" idempotent server-side. Cleared once the order is created. */
  idempotencyKey: string | null;
  addItem: (product: Product, quantity?: number) => { ok: boolean; error?: string };
  removeItem: (productId: string) => void;
  setQuantity: (productId: string, quantity: number) => void;
  clear: () => void;
  ensureIdempotencyKey: () => string;
  clearIdempotencyKey: () => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      idempotencyKey: null,

      addItem: (product, quantity = 1) => {
        const { items } = get();
        const otherCurrency = items.find((i) => i.currency !== product.currency);
        if (otherCurrency) {
          return {
            ok: false,
            error: `السلة فيها منتجات بعملة ${otherCurrency.currency} — لازم تكون كل المنتجات بنفس العملة. أكمل طلبك الحالي أو فضّي السلة الأول.`,
          };
        }

        const existing = items.find((i) => i.productId === product.id);
        const nextQuantity = Math.min(
          (existing?.quantity ?? 0) + quantity,
          Math.max(product.availableStock, 1),
        );

        if (existing) {
          set({
            items: items.map((i) =>
              i.productId === product.id ? { ...i, quantity: nextQuantity } : i,
            ),
          });
        } else {
          set({
            items: [
              ...items,
              {
                productId: product.id,
                slug: product.slug,
                name: product.name,
                price: product.price,
                currency: product.currency,
                image: product.images[0],
                quantity: nextQuantity,
                availableStock: product.availableStock,
              },
            ],
          });
        }
        return { ok: true };
      },

      removeItem: (productId) => set({ items: get().items.filter((i) => i.productId !== productId) }),

      setQuantity: (productId, quantity) =>
        set({
          items: get()
            .items.map((i) => (i.productId === productId ? { ...i, quantity } : i))
            .filter((i) => i.quantity > 0),
        }),

      clear: () => set({ items: [], idempotencyKey: null }),

      ensureIdempotencyKey: () => {
        const existing = get().idempotencyKey;
        if (existing) return existing;
        const key =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        set({ idempotencyKey: key });
        return key;
      },

      clearIdempotencyKey: () => set({ idempotencyKey: null }),
    }),
    { name: 'sqlm-cart', skipHydration: true },
  ),
);

export function cartSubtotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
}
