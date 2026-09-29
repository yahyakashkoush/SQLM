'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/store/auth-store';
import { useCartStore } from '@/store/cart-store';

/**
 * Both persisted stores use `skipHydration` so the server-rendered markup
 * and the client's first paint start from the same default state; this
 * rehydrates from localStorage right after mount instead, which avoids a
 * React hydration mismatch on every page that reads auth/cart state.
 */
export function StoreHydration() {
  useEffect(() => {
    void useAuthStore.persist.rehydrate();
    void useCartStore.persist.rehydrate();
  }, []);

  return null;
}
