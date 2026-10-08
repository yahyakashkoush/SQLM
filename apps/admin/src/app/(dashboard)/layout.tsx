'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Menu } from 'lucide-react';
import { Sidebar, navLabelFor } from '@/components/layout/sidebar';
import { useAuthStore } from '@/store/auth-store';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const hasSession = useAuthStore((s) => Boolean(s.accessToken));
  const [checked, setChecked] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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

  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  if (!checked || !hasSession) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="min-h-screen md:flex">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="min-w-0 flex-1">
        <header
          className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-3 backdrop-blur md:hidden"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <button
            onClick={() => setMenuOpen(true)}
            className="rounded-md p-2 hover:bg-accent"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <p className="truncate text-sm font-semibold">{navLabelFor(pathname)}</p>
        </header>
        <main className="mx-auto w-full max-w-[1400px] px-4 pb-24 pt-4 md:px-6 md:pb-10 md:pt-6">{children}</main>
      </div>
    </div>
  );
}
