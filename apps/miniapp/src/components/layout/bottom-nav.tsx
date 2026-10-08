'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Gift, Home, Package, ShieldCheck, ShoppingBag, User, Wallet } from 'lucide-react';
import { cn } from '@sqlm/ui';
import { useProfile } from '@/lib/queries';

/**
 * Five tabs; the fourth depends on who is holding the phone: staff get the
 * admin mode, merchants their wallet, everyone else the gifts.
 */
export function BottomNav() {
  const pathname = usePathname();
  const { data: profile } = useProfile();
  const fourth = profile?.staff
    ? { href: '/admin', label: 'الإدارة', icon: ShieldCheck }
    : profile?.wallet
      ? { href: '/wallet', label: 'المحفظة', icon: Wallet }
      : { href: '/gifts', label: 'هدايا', icon: Gift };
  const items = [
    { href: '/shop', label: 'الرئيسية', icon: Home },
    { href: '/products', label: 'المنتجات', icon: ShoppingBag },
    { href: '/orders', label: 'طلباتي', icon: Package },
    fourth,
    { href: '/account', label: 'حسابي', icon: User },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="grid grid-cols-5">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn('flex flex-col items-center gap-1 py-2 text-xs', active ? 'text-primary' : 'text-muted-foreground')}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
