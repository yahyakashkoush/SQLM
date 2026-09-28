'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, Gift, Loader2, Star, TicketPercent, X } from 'lucide-react';
import { Button, Card, CardContent, Input, Separator } from '@sqlm/ui';
import { usePaymentMethods } from '@/lib/queries';
import { cartSubtotal, useCartStore } from '@/store/cart-store';
import { useAuthStore } from '@/store/auth-store';
import { api, ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';

export default function CheckoutPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const items = useCartStore((s) => s.items);
  const clearCart = useCartStore((s) => s.clear);
  const ensureIdempotencyKey = useCartStore((s) => s.ensureIdempotencyKey);
  const clearIdempotencyKey = useCartStore((s) => s.clearIdempotencyKey);
  const accessToken = useAuthStore((s) => s.accessToken);

  const paymentMethods = usePaymentMethods();
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [couponInput, setCouponInput] = useState('');
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [checkingCoupon, setCheckingCoupon] = useState(false);

  const lines = items.map((i) => ({ productId: i.productId, quantity: i.quantity }));
  const quoteKey = ['order-quote', lines, appliedCode] as const;

  // The server prices the cart — member discount, coupon, and the amount to
  // transfer with each method — with the same function checkout charges
  // with, so nothing on this page is arithmetic the client made up.
  const quote = useQuery({
    queryKey: quoteKey,
    queryFn: () => api.quoteOrder(lines, appliedCode ?? undefined),
    enabled: Boolean(accessToken) && items.length > 0,
  });

  if (items.length === 0) {
    return (
      <main className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-muted-foreground">السلة فاضية.</p>
        <Button onClick={() => router.push('/products')}>تصفح المنتجات</Button>
      </main>
    );
  }

  if (!accessToken) {
    return (
      <main className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-muted-foreground">افتح التطبيق من جوه تيليجرام علشان تكمل الطلب.</p>
      </main>
    );
  }

  const priced = quote.data;
  const currency = priced?.currency ?? items[0]!.currency;
  const subtotal = priced ? Number(priced.subtotal) : cartSubtotal(items);
  const total = priced ? Number(priced.total) : subtotal;
  // Every enabled method is offered; the admin decides which ones exist.
  const methods = paymentMethods.data ?? [];
  const optionFor = (methodId: string) => priced?.paymentOptions.find((o) => o.paymentMethodId === methodId);
  const selectedOption = selectedMethod ? optionFor(selectedMethod) : undefined;
  const converted = selectedOption && selectedOption.currency !== currency ? selectedOption : undefined;

  const handleApplyCoupon = async () => {
    const code = couponInput.trim();
    if (!code) return;
    setCheckingCoupon(true);
    setCouponError(null);
    try {
      const next = await api.quoteOrder(lines, code);
      queryClient.setQueryData(['order-quote', lines, code], next);
      setAppliedCode(code);
    } catch (err) {
      setCouponError(err instanceof ApiError ? err.message : 'تعذّر التحقق من الكود.');
    } finally {
      setCheckingCoupon(false);
    }
  };

  const removeCoupon = () => {
    setAppliedCode(null);
    setCouponInput('');
    setCouponError(null);
  };

  const handlePlaceOrder = async () => {
    if (!selectedMethod) {
      setError('اختار طريقة الدفع الأول.');
      return;
    }
    if (!priced) {
      setError('استنى لحظة لحد ما السعر يتحسب.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const key = ensureIdempotencyKey();
      const order = await api.checkout({
        items: lines,
        paymentMethodId: selectedMethod,
        idempotencyKey: key,
        couponCode: appliedCode ?? undefined,
        expectedTotal: Number(priced.total),
      });
      clearCart();
      clearIdempotencyKey();
      // The order may now be holding the welcome gift.
      void queryClient.invalidateQueries({ queryKey: ['perks'] });
      router.push(`/orders/${order.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PRICE_CHANGED') {
        // Show the new price rather than charging it: the customer confirms again.
        await quote.refetch();
      }
      setError(err instanceof ApiError ? err.message : 'فشل إنشاء الطلب، حاول مرة أخرى.');
      setSubmitting(false);
    }
  };

  return (
    <main className="flex flex-col gap-4 p-4 pb-32">
      <h1 className="text-lg font-semibold">إتمام الطلب</h1>

      <Card>
        <CardContent className="flex flex-col gap-2 p-4">
          {items.map((item) => (
            <div key={item.productId} className="flex items-center justify-between text-sm">
              <span>
                {item.name} × {item.quantity}
              </span>
              <span>{formatMoney(Number(item.price) * item.quantity, item.currency)}</span>
            </div>
          ))}
          <Separator className="my-1" />
          {priced && Number(priced.discountTotal) > 0 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>المجموع</span>
              <span>{formatMoney(subtotal, currency)}</span>
            </div>
          )}
          {priced?.member && (
            <div className="flex items-center justify-between text-sm text-success">
              <span className="flex items-center gap-1">
                {priced.member.kind === 'VERIFIED' ? <Star className="h-3.5 w-3.5" /> : <Gift className="h-3.5 w-3.5" />}
                {priced.member.kind === 'VERIFIED' ? 'خصم العميل المميز' : 'هدية أول طلب'} ({priced.member.percent}%)
              </span>
              <span>−{formatMoney(priced.member.amount, currency)}</span>
            </div>
          )}
          {priced?.coupon && (
            <div className="flex items-center justify-between text-sm text-success">
              <span>خصم ({priced.coupon.code})</span>
              <span>−{formatMoney(priced.coupon.discount, currency)}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-sm font-semibold">
            <span>الإجمالي</span>
            <span className="flex items-center gap-1">
              {quote.isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              {formatMoney(total, currency)}
            </span>
          </div>
          {converted && (
            <div className="flex items-center justify-between rounded-md bg-primary/5 px-2 py-1.5 text-sm">
              <span>المطلوب تحويله</span>
              <span className="font-semibold">{formatMoney(converted.amount, converted.currency)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <TicketPercent className="h-4 w-4" /> كود خصم
          </p>
          {priced?.coupon ? (
            <div className="flex items-center justify-between rounded-lg border border-success/40 bg-success/5 p-3 text-sm">
              <span>
                <span className="font-mono font-semibold">{priced.coupon.code}</span> —{' '}
                <span className="text-success">وفّرت {formatMoney(priced.coupon.discount, currency)}</span>
              </span>
              <button type="button" onClick={removeCoupon} aria-label="إزالة الكود">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value)}
                placeholder="اكتب الكود"
                className="font-mono"
                dir="ltr"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleApplyCoupon();
                }}
              />
              <Button
                variant="outline"
                disabled={checkingCoupon || !couponInput.trim()}
                onClick={() => void handleApplyCoupon()}
              >
                {checkingCoupon ? <Loader2 className="h-4 w-4 animate-spin" /> : 'تطبيق'}
              </Button>
            </div>
          )}
          {couponError && <p className="text-xs text-destructive">{couponError}</p>}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">طريقة الدفع</h2>
        {paymentMethods.isLoading ? (
          <p className="text-xs text-muted-foreground">جاري تحميل طرق الدفع…</p>
        ) : methods.length === 0 ? (
          <p className="text-xs text-muted-foreground">لا توجد طرق دفع متاحة حالياً، تواصل مع الدعم.</p>
        ) : (
          methods.map((method) => {
            const selected = selectedMethod === method.id;
            const option = optionFor(method.id);
            const inOtherCurrency = option && option.currency !== currency;
            return (
              <button
                key={method.id}
                type="button"
                onClick={() => setSelectedMethod(method.id)}
                className={`flex items-start gap-3 rounded-lg border p-3 text-start text-sm transition ${
                  selected ? 'border-primary bg-primary/5' : 'border-input'
                }`}
              >
                {selected ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="flex-1">
                  <span className="block font-medium">{method.name}</span>
                  {method.description && <span className="block text-xs text-muted-foreground">{method.description}</span>}
                </span>
                {inOtherCurrency && (
                  <span className="shrink-0 text-xs font-semibold">{formatMoney(option.amount, option.currency)}</span>
                )}
              </button>
            );
          })
        )}
        <p className="text-xs text-muted-foreground">بعد تأكيد الطلب هتظهر لك بيانات التحويل وتقدر ترفع صورة الإيصال.</p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="fixed inset-x-0 bottom-16 z-40 border-t bg-background p-4">
        <Button className="w-full" size="lg" disabled={submitting || !priced} onClick={() => void handlePlaceOrder()}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          تأكيد الطلب —{' '}
          {converted ? formatMoney(converted.amount, converted.currency) : formatMoney(total, currency)}
        </Button>
      </div>
    </main>
  );
}
