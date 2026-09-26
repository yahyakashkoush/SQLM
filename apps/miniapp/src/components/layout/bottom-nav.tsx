'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, ShoppingBag, Package, LifeBuoy, User } from 'lucide-react';
import { cn } from '@sqlm/ui';

const NAV_ITEMS = [
  { href: '/shop', label: 'الرئيسية', icon: Home },
  { href: '/products', label: 'المنتجات', icon: ShoppingBag },
  { href: '/orders', label: 'طلباتي', icon: Package },
  { href: '/support', label: 'الدعم', icon: LifeBuoy },
  { href: '/account', label: 'حسابي', icon: User },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="grid grid-cols-5">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
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
