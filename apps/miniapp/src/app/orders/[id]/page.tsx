'use client';

import { use, useRef, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, LifeBuoy, Loader2, PackageCheck, Upload, XCircle } from 'lucide-react';
import { Button, Card, CardContent, Separator } from '@sqlm/ui';
import type { OrderStatus } from '@sqlm/shared';
import { useDeliveries, useOrder } from '@/lib/queries';
import { OrderStatusBadge } from '@/components/orders/order-status-badge';
import { CopyButton } from '@/components/copy-button';
import { api, ApiError } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';

const STATUS_HELP: Record<OrderStatus, string> = {
  CREATED: 'جاري تجهيز طلبك…',
  PENDING_PAYMENT: 'حوّل المبلغ على بيانات الدفع اللي تحت، وبعدها ارفع صورة الإيصال.',
  PAYMENT_SUBMITTED: 'استلمنا إثبات الدفع وهيتراجع خلال دقائق.',
  PAYMENT_REVIEW: 'فريقنا بيراجع الدفع دلوقتي. هنبعتلك رسالة أول ما يتأكد.',
  PAID: 'تم تأكيد الدفع ✓ جاري تجهيز طلبك.',
  PROCESSING: 'جاري تجهيز طلبك.',
  READY_FOR_DELIVERY: 'طلبك قيد التسليم وهيوصلك قريباً.',
  DELIVERED: 'تم تسليم طلبك ✓ البيانات موجودة تحت.',
  COMPLETED: 'الطلب مكتمل. شكراً لتعاملك معنا!',
  CANCELLED: 'تم إلغاء هذا الطلب.',
  REFUNDED: 'تم استرداد مبلغ هذا الطلب.',
  DISPUTED: 'الطلب قيد المراجعة. تواصل مع الدعم للمساعدة.',
};

const STEPS: Array<{ label: string; statuses: OrderStatus[] }> = [
  { label: 'الدفع', statuses: ['CREATED', 'PENDING_PAYMENT'] },
  { label: 'المراجعة', statuses: ['PAYMENT_SUBMITTED', 'PAYMENT_REVIEW'] },
  { label: 'التجهيز', statuses: ['PAID', 'PROCESSING', 'READY_FOR_DELIVERY'] },
  { label: 'التسليم', statuses: ['DELIVERED', 'COMPLETED'] },
];

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const { data: order, isLoading, refetch } = useOrder(id);
  const hasDeliveries = Boolean(order && ['PROCESSING', 'READY_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'DISPUTED'].includes(order.status));
  const deliveries = useDeliveries(id, hasDeliveries);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  if (isLoading) {
    return <main className="p-4 text-sm text-muted-foreground">جاري تحميل الطلب…</main>;
  }
  if (!order) {
    return <main className="p-8 text-center text-sm text-muted-foreground">الطلب غير موجود.</main>;
  }

  const method = order.paymentMethod;
  const lastProof = order.paymentProofs?.[0];
  const rejected = order.status === 'PENDING_PAYMENT' && lastProof?.status === 'REJECTED' ? lastProof : null;
  const stepIndex = STEPS.findIndex((s) => s.statuses.includes(order.status));
  const closed = ['CANCELLED', 'REFUNDED'].includes(order.status);

  const handleFileSelected = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      await api.uploadPaymentProof(order.id, file);
      await refetch();
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'فشل رفع الملف، حاول مرة أخرى.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <main className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">طلب #{order.sequenceNumber}</h1>
          <p className="text-xs text-muted-foreground">{formatDate(order.createdAt)}</p>
        </div>
        <OrderStatusBadge status={order.status} />
      </div>

      {!closed && stepIndex >= 0 && (
        <div className="flex items-center gap-1">
          {STEPS.map((step, i) => (
            <div key={step.label} className="flex flex-1 flex-col items-center gap-1">
              <div className={`h-1.5 w-full rounded-full ${i <= stepIndex ? 'bg-primary' : 'bg-muted'}`} />
              <span className={`text-[11px] ${i <= stepIndex ? 'text-foreground' : 'text-muted-foreground'}`}>{step.label}</span>
            </div>
          ))}
        </div>
      )}

      <p className="rounded-lg bg-muted p-3 text-sm">{STATUS_HELP[order.status]}</p>

      {rejected && (
        <div className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-destructive">تم رفض إثبات الدفع السابق</p>
            {rejected.rejectionReason && <p className="text-xs">السبب: {rejected.rejectionReason}</p>}
            <p className="text-xs text-muted-foreground">ارفع إثبات دفع جديد من تحت.</p>
          </div>
        </div>
      )}

      {deliveries.data && deliveries.data.length > 0 && (
        <Card className="border-success/40">
          <CardContent className="flex flex-col gap-3 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <PackageCheck className="h-4 w-4 text-success" /> بيانات طلبك
            </p>
            {deliveries.data.map((d) => (
              <div key={d.id} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{d.productName}</span>
                  {d.status === 'DELIVERED' ? (
                    <span className="flex items-center gap-1 text-xs text-success">
                      <CheckCircle2 className="h-3.5 w-3.5" /> تم التسليم
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" /> قيد التجهيز
                    </span>
                  )}
                </div>
                {d.content && (
                  <>
                    <pre dir="auto" className="whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-sm">
                      {d.content}
                    </pre>
                    <CopyButton value={d.content} label="نسخ البيانات" />
                  </>
                )}
                {d.deliveredAt && <p className="text-[11px] text-muted-foreground">سُلّم في {formatDate(d.deliveredAt)}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-col gap-2 p-4">
          {order.items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                {item.product?.images[0] && (
                  // eslint-disable-next-line @next/next/no-img-element -- admin-configured storage host
                  <img src={item.product.images[0]} alt="" className="h-8 w-8 rounded object-cover" />
                )}
                {item.productNameSnapshot} × {item.quantity}
              </span>
              <span>{formatMoney(Number(item.unitPrice) * item.quantity, order.currency)}</span>
            </div>
          ))}
          <Separator className="my-1" />
          <div className="flex items-center justify-between text-sm font-semibold">
            <span>الإجمالي</span>
            <span>{formatMoney(order.total, order.currency)}</span>
          </div>
        </CardContent>
      </Card>

      {order.status === 'PENDING_PAYMENT' && (
        <>
          {method && (
            <Card>
              <CardContent className="flex flex-col gap-3 p-4">
                <p className="text-sm font-semibold">الدفع عن طريق {method.name}</p>
                <div className="flex items-center justify-between gap-2 rounded-lg bg-muted p-3">
                  <div>
                    <p className="text-xs text-muted-foreground">المبلغ المطلوب</p>
                    <p className="text-lg font-bold">{formatMoney(order.total, order.currency)}</p>
                  </div>
                  <CopyButton value={String(Number(order.total))} label="نسخ المبلغ" />
                </div>
                {method.accountNumber && (
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-muted p-3">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">حوّل على</p>
                      <p dir="ltr" className="break-all text-start font-mono text-base font-semibold">
                        {method.accountNumber}
                      </p>
                    </div>
                    <CopyButton value={method.accountNumber} />
                  </div>
                )}
                {method.instructions && <p className="whitespace-pre-line text-sm text-muted-foreground">{method.instructions}</p>}
                {method.qrCodeUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- admin-configured storage host
                  <img src={method.qrCodeUrl} alt="QR" className="mx-auto h-48 w-48 rounded-lg border object-contain" />
                )}
                <p className="text-xs text-muted-foreground">اكتب رقم الطلب #{order.sequenceNumber} في ملاحظة التحويل لو متاح.</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="flex flex-col gap-3 p-4">
              <p className="text-sm font-semibold">ارفع إثبات الدفع</p>
              <p className="text-xs text-muted-foreground">
                سكرين شوت أو صورة لإيصال التحويل (JPG أو PNG أو PDF). تقدر كمان تبعت الصورة مباشرة في شات البوت.
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
              <Button disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploading ? 'جاري الرفع…' : 'اختار صورة الإيصال'}
              </Button>
              {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
            </CardContent>
          </Card>
        </>
      )}

      {lastProof && order.status !== 'PENDING_PAYMENT' && lastProof.status === 'PENDING' && (
        <p className="text-center text-xs text-muted-foreground">تم رفع إثبات الدفع {formatDate(lastProof.uploadedAt)}</p>
      )}

      <Link href={`/support?order=${order.id}`} className="flex items-center justify-center gap-2 py-2 text-sm text-primary">
        <LifeBuoy className="h-4 w-4" /> محتاج مساعدة في الطلب ده؟
      </Link>
    </main>
  );
}
