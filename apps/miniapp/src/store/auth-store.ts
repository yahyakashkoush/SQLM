import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CustomerProfile } from '@/types/api';

interface AuthState {
  accessToken: string | null;
  customer: CustomerProfile | null;
  setSession: (accessToken: string, customer: CustomerProfile) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      customer: null,
      setSession: (accessToken, customer) => set({ accessToken, customer }),
      clearSession: () => set({ accessToken: null, customer: null }),
    }),
    { name: 'sqlm-auth', skipHydration: true },
  ),
);
