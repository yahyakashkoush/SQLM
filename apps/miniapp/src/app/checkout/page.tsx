'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button, Card, CardContent, Separator } from '@sqlm/ui';
import { usePaymentMethods } from '@/lib/queries';
import { cartSubtotal, useCartStore } from '@/store/cart-store';
import { useAuthStore } from '@/store/auth-store';
import { api, ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';

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

  if (items.length === 0) {
    return (
      <main className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-muted-foreground">Your cart is empty.</p>
        <Button onClick={() => router.push('/products')}>Browse products</Button>
      </main>
    );
  }

  if (!accessToken) {
    return (
      <main className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Open this Mini App from Telegram to sign in before checking out.
        </p>
      </main>
    );
  }

  const subtotal = cartSubtotal(items);
  const currency = items[0]!.currency;
  const methodsForCurrency = paymentMethods.data?.filter((m) => m.currency === currency) ?? [];

  const handlePlaceOrder = async () => {
    if (!selectedMethod) {
      setError('Choose a payment method to continue.');
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
      });
      clearCart();
      clearIdempotencyKey();
      router.push(`/orders/${order.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Checkout failed. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <main className="flex flex-col gap-4 p-4 pb-28">
      <h1 className="text-lg font-semibold">Checkout</h1>

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
          <div className="flex items-center justify-between text-sm font-semibold">
            <span>Total</span>
            <span>{formatMoney(subtotal, currency)}</span>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Payment method</h2>
        {paymentMethods.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading payment methods...</p>
        ) : methodsForCurrency.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No payment methods available for {currency} right now. Please contact support.
          </p>
        ) : (
          methodsForCurrency.map((method) => (
            <button
              key={method.id}
              type="button"
              onClick={() => setSelectedMethod(method.id)}
              className={`rounded-lg border p-3 text-left text-sm transition ${
                selectedMethod === method.id ? 'border-primary bg-primary/5' : 'border-input'
              }`}
            >
              <p className="font-medium">{method.name}</p>
              {method.description && (
                <p className="text-xs text-muted-foreground">{method.description}</p>
              )}
            </button>
          ))
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="fixed inset-x-0 bottom-16 z-40 border-t bg-background p-4">
        <Button className="w-full" size="lg" disabled={submitting} onClick={() => void handlePlaceOrder()}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Place order
        </Button>
      </div>
    </main>
  );
}
