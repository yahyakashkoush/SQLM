import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ROLE_PERMISSIONS, type Permission, type Role } from '@sqlm/shared';

export interface StaffProfile {
  id: string;
  email: string;
  name: string;
  role: Role;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  staff: StaffProfile | null;
  setSession: (accessToken: string, refreshToken: string, staff: StaffProfile) => void;
  setAccessToken: (accessToken: string) => void;
  clearSession: () => void;
  can: (permission: Permission) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      staff: null,
      setSession: (accessToken, refreshToken, staff) => set({ accessToken, refreshToken, staff }),
      setAccessToken: (accessToken) => set({ accessToken }),
      clearSession: () => set({ accessToken: null, refreshToken: null, staff: null }),
      // Derived from the same ROLE_PERMISSIONS map the server guards use,
      // so the two can't drift. This only decides what to *render* — every
      // endpoint re-checks the permission itself regardless.
      can: (permission) => {
        const role = get().staff?.role;
        return role ? ROLE_PERMISSIONS[role].includes(permission) : false;
      },
    }),
    { name: 'sqlm-admin-auth', skipHydration: true },
  ),
);
