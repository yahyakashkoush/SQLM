'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Loader2, ShieldAlert } from 'lucide-react';
import type { Permission } from '@sqlm/shared';
import { ApiError } from '@/lib/api';
import { adminApi, ensureStaffSession, staffCan } from '@/lib/admin-api';
import { useStaffStore } from '@/store/staff-store';
import { useTelegram } from '@/components/providers/telegram-provider';

const NAV: Array<{
  href: string;
  label: string;
  permission: Permission;
  badge?: 'proofs' | 'topups';
}> = [
  { href: '/admin', label: 'الرئيسية', permission: 'orders.read' },
  {
    href: '/admin/proofs',
    label: 'الإيصالات',
    permission: 'payments.proofs.read',
    badge: 'proofs',
  },
  {
    href: '/admin/topups',
    label: 'شحن الرصيد',
    permission: 'payments.proofs.read',
    badge: 'topups',
  },
  { href: '/admin/orders', label: 'الطلبات', permission: 'orders.read' },
  { href: '/admin/customers', label: 'العملاء', permission: 'customers.read' },
  { href: '/admin/wholesale', label: 'الجملة', permission: 'customers.read' },
  { href: '/admin/products', label: 'المنتجات', permission: 'products.read' },
  { href: '/admin/profits', label: 'الأرباح', permission: 'analytics.read' },
];

const ROLE_AR: Record<string, string> = {
  OWNER: 'المالك',
  ADMIN: 'مدير',
  PAYMENT_REVIEWER: 'مراجع مدفوعات',
  SUPPORT_AGENT: 'دعم فني',
  DELIVERY_AGENT: 'تسليم',
};

/**
 * The admin mode: the same admin API as the dashboard, signed in from the
 * Telegram session, with the staff member's own permissions. Buttons a role
 * can't use are hidden, and the server refuses them anyway.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { ready } = useTelegram();
  const staff = useStaffStore((s) => s.staff);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!ready) return;
    ensureStaffSession().catch((err) =>
      setError(err instanceof ApiError ? err : new ApiError(500, 'حصل خطأ')),
    );
  }, [ready]);

  const counts = useQuery({
    queryKey: ['admin', 'nav-counts'],
    queryFn: async () => {
      const [stats, topUps] = await Promise.all([
        staffCan('orders.read') ? adminApi.stats().catch(() => null) : null,
        staffCan('payments.proofs.read') ? adminApi.topUps('PENDING').catch(() => []) : [],
      ]);
      return { proofs: stats?.pendingProofs ?? 0, topups: topUps.length };
    },
    enabled: Boolean(staff),
    refetchInterval: 30_000,
  });

  if (error) {
    return (
      <main className="flex flex-col items-center gap-3 p-8 pt-20 text-center">
        <ShieldAlert className="h-10 w-10 text-muted-foreground" />
        <p className="font-semibold">
          {error.code === 'NOT_STAFF'
            ? 'الحساب ده مش من فريق الإدارة'
            : 'مقدرناش ندخلك لوحة التحكم'}
        </p>
        <p className="max-w-xs text-sm text-muted-foreground">
          {error.code === 'NOT_STAFF'
            ? 'اربط حساب تيليجرام بتاعك من لوحة التحكم على الموقع (Telegram Bot ← Link) وبعدها افتح هنا تاني.'
            : error.message}
        </p>
        <Link href="/account" className="text-sm text-primary underline">
          رجوع لحسابي
        </Link>
      </main>
    );
  }
  if (!staff) {
    return (
      <main className="flex items-center justify-center gap-2 p-8 pt-24 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> بيدخلك لوحة التحكم…
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between px-4 pb-2 pt-3">
          <div>
            <p className="text-sm font-semibold">🛠️ لوحة التحكم</p>
            <p className="text-[11px] text-muted-foreground">
              {staff.name} · {ROLE_AR[staff.role] ?? staff.role}
            </p>
          </div>
          <Link href="/shop" className="rounded-full border px-3 py-1 text-xs">
            المتجر
          </Link>
        </div>
        <nav className="flex gap-1.5 overflow-x-auto px-4 pb-2" aria-label="أقسام الإدارة">
          {NAV.filter((n) => staffCan(n.permission)).map((n) => {
            const active =
              n.href === '/admin' ? pathname === '/admin' : pathname.startsWith(n.href);
            const badge = n.badge ? counts.data?.[n.badge] : 0;
            return (
              <Link
                key={n.href}
                href={n.href}
                ref={
                  active
                    ? (el) => el?.scrollIntoView({ block: 'nearest', inline: 'center' })
                    : undefined
                }
                className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs ${active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
              >
                {n.label}
                {badge ? (
                  <span
                    className={`rounded-full px-1.5 text-[10px] font-bold ${active ? 'bg-primary-foreground text-primary' : 'bg-destructive text-destructive-foreground'}`}
                  >
                    {badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="space-y-4 p-4">{children}</main>
    </div>
  );
}
