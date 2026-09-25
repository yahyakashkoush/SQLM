'use client';

import { use, useRef, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { Button, Card, CardContent, Separator } from '@sqlm/ui';
import { usePaymentMethods, useOrder } from '@/lib/queries';
import { OrderStatusBadge } from '@/components/orders/order-status-badge';
import { api, ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import type { OrderStatus } from '@sqlm/shared';

const STATUS_HELP: Record<OrderStatus, string> = {
  CREATED: 'Preparing your order...',
  PENDING_PAYMENT: 'Upload proof of payment below to continue.',
  PAYMENT_SUBMITTED: 'Your payment proof was received and is queued for review.',
  PAYMENT_REVIEW: 'Our team is reviewing your payment.',
  PAID: 'Payment confirmed. Your order is being prepared.',
  PROCESSING: 'Your order is being processed.',
  READY_FOR_DELIVERY: 'Your order is ready and will be delivered shortly.',
  DELIVERED: 'Your order has been delivered.',
  COMPLETED: 'This order is complete. Thanks for your purchase!',
  CANCELLED: 'This order was cancelled.',
  REFUNDED: 'This order was refunded.',
  DISPUTED: 'This order is under dispute. Contact support for help.',
};

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: order, isLoading, refetch } = useOrder(id);
  const paymentMethods = usePaymentMethods();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  if (isLoading) {
    return <main className="p-4 text-sm text-muted-foreground">Loading order...</main>;
  }

  if (!order) {
    return <main className="p-8 text-center text-sm text-muted-foreground">Order not found.</main>;
  }

  const paymentMethod = paymentMethods.data?.find((m) => m.id === order.paymentMethodId);

  const handleFileSelected = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      await api.uploadPaymentProof(order.id, file);
      await refetch();
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <main className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Order #{order.sequenceNumber}</h1>
        <OrderStatusBadge status={order.status} />
      </div>

      <p className="text-sm text-muted-foreground">{STATUS_HELP[order.status]}</p>

      <Card>
        <CardContent className="flex flex-col gap-2 p-4">
          {order.items.map((item) => (
            <div key={item.id} className="flex items-center justify-between text-sm">
              <span>
                {item.productNameSnapshot} × {item.quantity}
              </span>
              <span>{formatMoney(Number(item.unitPrice) * item.quantity, order.currency)}</span>
            </div>
          ))}
          <Separator className="my-1" />
          <div className="flex items-center justify-between text-sm font-semibold">
            <span>Total</span>
            <span>{formatMoney(order.total, order.currency)}</span>
          </div>
        </CardContent>
      </Card>

      {order.status === 'PENDING_PAYMENT' && (
        <>
          {paymentMethod && (
            <Card>
              <CardContent className="flex flex-col gap-2 p-4">
                <p className="text-sm font-medium">How to pay — {paymentMethod.name}</p>
                {paymentMethod.accountNumber && (
                  <p className="break-all text-sm text-muted-foreground">
                    {paymentMethod.accountNumber}
                  </p>
                )}
                {paymentMethod.instructions && (
                  <p className="whitespace-pre-line text-xs text-muted-foreground">
                    {paymentMethod.instructions}
                  </p>
                )}
                {paymentMethod.qrCodeUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- admin-configured storage host
                  <img
                    src={paymentMethod.qrCodeUrl}
                    alt="Payment QR code"
                    className="mx-auto h-40 w-40 object-contain"
                  />
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="flex flex-col gap-3 p-4">
              <p className="text-sm font-medium">Upload payment proof</p>
              <p className="text-xs text-muted-foreground">
                A screenshot or photo of your payment confirmation (JPG, PNG, or PDF).
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFileSelected(file);
                }}
              />
              <Button
                variant="outline"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {uploading ? 'Uploading...' : 'Choose file'}
              </Button>
              {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
