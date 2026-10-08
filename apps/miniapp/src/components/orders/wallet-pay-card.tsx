'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Wallet } from 'lucide-react';
import { Button, Card, CardContent } from '@sqlm/ui';
import { api, ApiError } from '@/lib/api';
import { useProfile } from '@/lib/queries';
import { formatMoney } from '@/lib/format';
import type { Order } from '@/types/api';

/** For a merchant with a wallet: settle a waiting order from the balance in one tap. */
export function WalletPayCard({ order, onPaid }: { order: Order; onPaid: () => void }) {
  const queryClient = useQueryClient();
  const { data: profile } = useProfile();
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wallet = profile?.wallet;
  if (!wallet || wallet.currency !== order.currency) return null;
  const enough = Number(wallet.balance) >= Number(order.total);

  const pay = async () => {
    setPaying(true);
    setError(null);
    try {
      await api.payOrderFromWallet(order.id);
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');
      onPaid();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setPaying(false);
    }
  };

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Wallet className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold">ادفع من رصيد المحفظة</p>
            <p className="text-xs text-muted-foreground">
              رصيدك {formatMoney(wallet.balance, wallet.currency)} · من غير إيصال، والطلب بيتأكد
              فوراً.
            </p>
          </div>
        </div>
        {enough ? (
          <Button disabled={paying} onClick={() => void pay()}>
            {paying && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            ادفع {formatMoney(order.total, order.currency)} من الرصيد
          </Button>
        ) : (
          <Button variant="outline" asChild>
            <Link href="/wallet">رصيدك مش كفاية — اشحن الأول</Link>
          </Button>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
