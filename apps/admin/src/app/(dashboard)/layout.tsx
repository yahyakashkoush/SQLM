'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { useAuthStore } from '@/store/auth-store';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const hasSession = useAuthStore((s) => Boolean(s.accessToken));
  const [checked, setChecked] = useState(false);

  // Waits one tick for the persisted store to rehydrate before deciding —
  // otherwise a valid session would bounce to /login on every reload.
  useEffect(() => {
    const unsub = useAuthStore.persist.onFinishHydration(() => setChecked(true));
    if (useAuthStore.persist.hasHydrated()) setChecked(true);
    return unsub;
  }, []);

  useEffect(() => {
    if (checked && !hasSession) router.replace('/login');
  }, [checked, hasSession, router]);

  if (!checked || !hasSession) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="flex">
      <Sidebar />
      <main className="h-screen flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
