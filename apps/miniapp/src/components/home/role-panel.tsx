'use client';

import Link from 'next/link';
import { ChevronLeft, Package, Plus, ShieldCheck, Store, Wallet } from 'lucide-react';
import { useProfile } from '@/lib/queries';
import { formatMoney } from '@/lib/format';

/**
 * The top of the home screen changes with the account: staff see a door
 * into the admin mode, merchants their balance and wholesale shortcuts.
 * Regular customers see nothing here — the perks banner speaks to them.
 */
export function RolePanel() {
  const { data: profile } = useProfile();
  if (!profile) return null;

  return (
    <div className="space-y-3">
      {profile.staff && (
        <Link
          href="/admin"
          className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-3 text-sm"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <span className="flex-1">
            <span className="block font-semibold">لوحة التحكم</span>
            <span className="block text-xs text-muted-foreground">
              الإيصالات، الطلبات، العملاء والأرباح — من هنا.
            </span>
          </span>
          <ChevronLeft className="h-4 w-4 text-muted-foreground" />
        </Link>
      )}

      {profile.wallet && (
        <section className="overflow-hidden rounded-2xl bg-gradient-to-l from-primary to-primary/80 p-4 text-primary-foreground shadow-md">
          <div className="flex items-start justify-between">
            <div>
              <p className="flex items-center gap-1.5 text-xs opacity-85">
                <Store className="h-3.5 w-3.5" /> حساب تاجر جملة
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums" dir="ltr">
                {formatMoney(profile.wallet.balance, profile.wallet.currency)}
              </p>
              <p className="text-[11px] opacity-80">رصيدك المتاح للشراء</p>
            </div>
            <Wallet className="h-7 w-7 opacity-60" />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <Shortcut href="/wallet" icon={<Plus className="h-4 w-4" />} label="شحن" />
            <Shortcut href="/wholesale" icon={<Store className="h-4 w-4" />} label="أسعار الجملة" />
            <Shortcut href="/orders" icon={<Package className="h-4 w-4" />} label="طلباتي" />
          </div>
        </section>
      )}
    </div>
  );
}

function Shortcut({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-1 rounded-xl bg-white/15 py-2 font-medium backdrop-blur"
    >
      {icon}
      {label}
    </Link>
  );
}
