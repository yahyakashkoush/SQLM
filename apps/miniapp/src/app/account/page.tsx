'use client';

import Link from 'next/link';
import { LifeBuoy, Package, User } from 'lucide-react';
import { Card, CardContent } from '@sqlm/ui';
import { useAuthStore } from '@/store/auth-store';
import { useTelegram } from '@/components/providers/telegram-provider';

export default function AccountPage() {
  const customer = useAuthStore((s) => s.customer);
  const { authError, inTelegram } = useTelegram();

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">Account</h1>

      {customer ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <User className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">{customer.firstName ?? 'Telegram user'}</p>
              {customer.username && (
                <p className="text-xs text-muted-foreground">@{customer.username}</p>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">
          {!inTelegram ? 'Open this app inside Telegram to sign in.' : (authError ?? 'Signing you in...')}
        </p>
      )}

      <Link href="/orders">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Package className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium">Your orders</span>
          </CardContent>
        </Card>
      </Link>

      <Link href="/support">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <LifeBuoy className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium">Support</span>
          </CardContent>
        </Card>
      </Link>
    </main>
  );
}
