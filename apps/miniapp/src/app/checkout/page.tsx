'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Circle, Loader2, TicketPercent, X } from 'lucide-react';
import { Button, Card, CardContent, Input, Separator } from '@sqlm/ui';
import { usePaymentMethods } from '@/lib/queries';
import { cartSubtotal, useCartStore } from '@/store/cart-store';
import { useAuthStore } from '@/store/auth-store';
import { api, ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import type { CouponQuote } from '@/types/api';

export default function CheckoutPage() {
  const router = useRouter();
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
  const [coupon, setCoupon] = useState<CouponQuote | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [checkingCoupon, setCheckingCoupon] = useState(false);

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

  const subtotal = cartSubtotal(items);
  const payable = coupon ? Number(coupon.total) : subtotal;
  const currency = items[0]!.currency;
  // Every enabled method is offered; the admin decides which ones exist.
  const methods = paymentMethods.data ?? [];

  const handleApplyCoupon = async () => {
    const code = couponInput.trim();
    if (!code) return;
    setCheckingCoupon(true);
    setCouponError(null);
    try {
      // Quoted against the cart server-side, so the number shown here is
      // the number checkout will charge.
      const quote = await api.quoteCoupon(
        code,
        items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      );
      setCoupon(quote);
    } catch (err) {
      setCoupon(null);
      setCouponError(err instanceof ApiError ? err.message : 'تعذّر التحقق من الكود.');
    } finally {
      setCheckingCoupon(false);
    }
  };

  const removeCoupon = () => {
    setCoupon(null);
    setCouponInput('');
    setCouponError(null);
  };

  const handlePlaceOrder = async () => {
    if (!selectedMethod) {
      setError('اختار طريقة الدفع الأول.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const key = ensureIdempotencyKey();
      const order = await api.checkout({
        items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        paymentMethodId: selectedMethod,
        idempotencyKey: key,
        couponCode: coupon?.code,
      });
      clearCart();
      clearIdempotencyKey();
      router.push(`/orders/${order.id}`);
    } catch (err) {
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
          {coupon && (
            <>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>المجموع</span>
                <span>{formatMoney(subtotal, currency)}</span>
              </div>
              <div className="flex items-center justify-between text-sm text-success">
                <span>خصم ({coupon.code})</span>
                <span>−{formatMoney(coupon.discount, currency)}</span>
              </div>
            </>
          )}
          <div className="flex items-center justify-between text-sm font-semibold">
            <span>الإجمالي</span>
            <span>{formatMoney(payable, currency)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <TicketPercent className="h-4 w-4" /> كود خصم
          </p>
          {coupon ? (
            <div className="flex items-center justify-between rounded-lg border border-success/40 bg-success/5 p-3 text-sm">
              <span>
                <span className="font-mono font-semibold">{coupon.code}</span> —{' '}
                <span className="text-success">وفّرت {formatMoney(coupon.discount, currency)}</span>
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
                <span>
                  <span className="block font-medium">{method.name}</span>
                  {method.description && <span className="block text-xs text-muted-foreground">{method.description}</span>}
                </span>
              </button>
            );
          })
        )}
        <p className="text-xs text-muted-foreground">بعد تأكيد الطلب هتظهر لك بيانات التحويل وتقدر ترفع صورة الإيصال.</p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="fixed inset-x-0 bottom-16 z-40 border-t bg-background p-4">
        <Button className="w-full" size="lg" disabled={submitting} onClick={() => void handlePlaceOrder()}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          تأكيد الطلب — {formatMoney(payable, currency)}
        </Button>
      </div>
    </main>
  );
}
