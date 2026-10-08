import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Product, ProductBundle } from '@/types/api';

export interface CartItem {
  /** productId, or productId:bundleId — the same product can sit in the cart singly and as a bundle. */
  key: string;
  productId: string;
  bundleId?: string;
  bundleLabel?: string;
  /** Units per line quantity: 1 for singles, the bundle size for a bundle. */
  unitsPer: number;
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
  addItem: (product: Product, quantity?: number, bundle?: ProductBundle) => { ok: boolean; error?: string };
  removeItem: (key: string) => void;
  setQuantity: (key: string, quantity: number) => void;
  clear: () => void;
  ensureIdempotencyKey: () => string;
  clearIdempotencyKey: () => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      idempotencyKey: null,

      addItem: (product, quantity = 1, bundle) => {
        const items = get().items.map(normalize);
        const otherCurrency = items.find((i) => i.currency !== product.currency);
        if (otherCurrency) {
          return {
            ok: false,
            error: `السلة فيها منتجات بعملة ${otherCurrency.currency} — لازم تكون كل المنتجات بنفس العملة. أكمل طلبك الحالي أو فضّي السلة الأول.`,
          };
        }

        const key = bundle ? `${product.id}:${bundle.id}` : product.id;
        const unitsPer = bundle?.quantity ?? 1;
        // Units this product already holds in other lines (single vs bundle).
        const otherUnits = items
          .filter((i) => i.productId === product.id && i.key !== key)
          .reduce((sum, i) => sum + i.quantity * i.unitsPer, 0);
        const maxLines = Math.floor(Math.max(product.availableStock - otherUnits, 0) / unitsPer);
        if (maxLines < 1) {
          return { ok: false, error: 'الكمية المتاحة مش كفاية للاختيار ده.' };
        }

        const existing = items.find((i) => i.key === key);
        const nextQuantity = Math.min((existing?.quantity ?? 0) + quantity, maxLines);

        if (existing) {
          set({ items: items.map((i) => (i.key === key ? { ...i, quantity: nextQuantity } : i)) });
        } else {
          set({
            items: [
              ...items,
              {
                key,
                productId: product.id,
                bundleId: bundle?.id,
                bundleLabel: bundle ? bundle.label?.trim() || `باقة ${bundle.quantity}` : undefined,
                unitsPer,
                slug: product.slug,
                name: product.name,
                price: bundle?.price ?? product.price,
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

      removeItem: (key) => set({ items: get().items.map(normalize).filter((i) => i.key !== key) }),

      setQuantity: (key, quantity) =>
        set({
          items: get()
            .items.map(normalize)
            .map((i) => (i.key === key ? { ...i, quantity } : i))
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
    {
      name: 'sqlm-cart',
      skipHydration: true,
      version: 2,
      migrate: (state) => {
        const old = state as { items?: CartItem[] };
        return { ...old, items: (old.items ?? []).map(normalize) } as CartState;
      },
    },
  ),
);

/** Carts saved before bundles existed have no key/unitsPer. */
function normalize(item: CartItem): CartItem {
  return item.key ? item : { ...item, key: item.productId, unitsPer: 1 };
}

export function cartLines(items: CartItem[]): Array<{ productId: string; quantity: number; bundleId?: string }> {
  return items.map((i) => ({
    productId: i.productId,
    quantity: i.quantity,
    ...(i.bundleId ? { bundleId: i.bundleId } : {}),
  }));
}

export function cartSubtotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
}
