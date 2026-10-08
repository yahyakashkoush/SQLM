import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface StaffSession {
  id: string;
  name: string;
  role: string;
  email: string;
}

interface StaffState {
  accessToken: string | null;
  refreshToken: string | null;
  staff: StaffSession | null;
  setSession: (s: { accessToken: string; refreshToken: string; staff: StaffSession }) => void;
  clearSession: () => void;
}

/**
 * The admin mode's staff session. Session storage, not local storage: it
 * dies with the Mini App, and opening it again signs back in from the
 * Telegram session in a second — nothing long-lived sits on the phone.
 */
export const useStaffStore = create<StaffState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      staff: null,
      setSession: ({ accessToken, refreshToken, staff }) =>
        set({ accessToken, refreshToken, staff }),
      clearSession: () => set({ accessToken: null, refreshToken: null, staff: null }),
    }),
    { name: 'sqlm-staff', storage: createJSONStorage(() => sessionStorage) },
  ),
);
