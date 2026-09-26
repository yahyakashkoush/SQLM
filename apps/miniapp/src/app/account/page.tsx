'use client';

import Link from 'next/link';
import { ChevronLeft, LifeBuoy, Package, ShoppingCart, User } from 'lucide-react';
import { Card, CardContent } from '@sqlm/ui';
import { useAuthStore } from '@/store/auth-store';
import { useTelegram } from '@/components/providers/telegram-provider';
import { useStoreInfo } from '@/lib/queries';

export default function AccountPage() {
  const customer = useAuthStore((s) => s.customer);
  const { authError, inTelegram } = useTelegram();
  const store = useStoreInfo();

  const links = [
    { href: '/orders', label: 'طلباتي', icon: Package },
    { href: '/cart', label: 'السلة', icon: ShoppingCart },
    { href: '/support', label: 'الدعم الفني', icon: LifeBuoy },
  ];

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">حسابي</h1>

      {customer ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <User className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">{customer.firstName ?? 'مستخدم تيليجرام'}</p>
              {customer.username && <p className="text-xs text-muted-foreground" dir="ltr">@{customer.username}</p>}
            </div>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">
          {!inTelegram ? 'افتح التطبيق من جوه تيليجرام علشان تسجل دخول.' : (authError ?? 'جاري تسجيل الدخول…')}
        </p>
      )}

      {links.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href}>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Icon className="h-5 w-5 text-muted-foreground" />
              <span className="flex-1 text-sm font-medium">{label}</span>
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      ))}

      {store.data?.supportContact && (
        <p className="text-center text-xs text-muted-foreground">
          للتواصل المباشر: <span dir="ltr">{store.data.supportContact}</span>
        </p>
      )}
    </main>
  );
}
