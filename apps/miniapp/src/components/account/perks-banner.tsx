'use client';

import { Gift, ShieldCheck, Star } from 'lucide-react';
import { Card, CardContent } from '@sqlm/ui';
import { usePerks } from '@/lib/queries';

/**
 * The customer's tier and what it gets them: the welcome gift for a
 * regular customer, the standing discount for a verified one. Everything
 * shown comes from the server, which is also what applies it at checkout,
 * so a banner can never promise a discount the order will not give.
 *
 * `compact` (the shop) stays silent when there is nothing to offer; the
 * account page always shows the tier.
 */
export function PerksBanner({ compact = false }: { compact?: boolean }) {
  const { data } = usePerks();
  if (!data) return null;

  const standing = data.verifiedDiscountPercent;

  if (data.tier === 'VERIFIED') {
    if (compact && standing <= 0) return null;
    return (
      <Card className="border-warning/40 bg-warning/5">
        <CardContent className="flex items-start gap-3 p-4">
          <Star className="mt-0.5 h-5 w-5 shrink-0 fill-warning text-warning" />
          <div className="text-sm">
            <p className="font-semibold">عميل مميز وموثّق ⭐</p>
            <p className="text-muted-foreground">
              {standing > 0
                ? `ليك خصم ${standing}% على كل طلباتك — بيتطبّق تلقائي في صفحة الدفع.`
                : 'شكراً لثقتك — حسابك موثّق.'}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const gift = data.welcomeGift;
  const promise = standing > 0 ? `وبعد أول طلب مدفوع هتبقى عميل مميز وموثّق وليك خصم ${standing}% دايم.` : null;

  if (gift?.available) {
    return (
      <Card className="border-primary/40 bg-primary/5">
        <CardContent className="flex items-start gap-3 p-4">
          <Gift className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="text-sm">
            <p className="whitespace-pre-line font-semibold">{gift.message}</p>
            {promise && <p className="text-muted-foreground">{promise}</p>}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (gift && !gift.available) {
    if (compact) return null;
    return (
      <Card>
        <CardContent className="flex items-start gap-3 p-4 text-sm">
          <Gift className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">
            هدية أول طلب مستخدمة في طلب لسه مدفعش. لو لغيته بترجعلك.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!promise) {
    if (compact) return null;
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-4 text-sm">
          <ShieldCheck className="h-5 w-5 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">حسابك بيتوثّق تلقائي بعد أول طلب مدفوع.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4 text-sm">
        <Star className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
        <p>بعد أول طلب مدفوع هتبقى عميل مميز وموثّق وليك خصم {standing}% على كل طلباتك.</p>
      </CardContent>
    </Card>
  );
}
