'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, ShieldCheck, ShoppingCart, Zap } from 'lucide-react';
import { Badge, Button, Separator, Skeleton } from '@sqlm/ui';
import { useProduct } from '@/lib/queries';
import { useCartStore } from '@/store/cart-store';
import { formatMoney } from '@/lib/format';

export default function ProductDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const { data: product, isLoading } = useProduct(slug);
  const addItem = useCartStore((s) => s.addItem);
  const [quantity, setQuantity] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  if (isLoading) {
    return (
      <main className="flex flex-col gap-4 p-4">
        <Skeleton className="aspect-square w-full rounded-lg" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-full" />
      </main>
    );
  }

  if (!product) {
    return (
      <main className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-muted-foreground">المنتج غير موجود.</p>
        <Button variant="outline" onClick={() => router.push('/products')}>
          الرجوع للمنتجات
        </Button>
      </main>
    );
  }

  const outOfStock = product.availableStock <= 0;
  const maxQuantity = Math.max(1, Math.min(product.availableStock, 50));
  const autoDelivery =
    product.inventoryMode === 'INDIVIDUAL' && !['MANUAL', 'CUSTOM'].includes(product.deliveryType);
  const hasDiscount = product.compareAtPrice && Number(product.compareAtPrice) > Number(product.price);

  const handleAdd = (goToCart: boolean) => {
    const result = addItem(product, quantity);
    if (result.ok && goToCart) {
      router.push('/cart');
      return;
    }
    setFeedback(result.ok ? { ok: true, text: 'تمت الإضافة للسلة ✓' } : { ok: false, text: result.error ?? 'تعذر الإضافة للسلة' });
  };

  return (
    <main className="flex flex-col gap-4 pb-32">
      <div className="relative aspect-square w-full bg-muted">
        {product.images[imageIndex] ? (
          // eslint-disable-next-line @next/next/no-img-element -- admin-configured storage host
          <img src={product.images[imageIndex]} alt={product.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">لا توجد صورة</div>
        )}
        {hasDiscount && (
          <Badge variant="destructive" className="absolute start-3 top-3">
            خصم {Math.round((1 - Number(product.price) / Number(product.compareAtPrice)) * 100)}%
          </Badge>
        )}
      </div>
      {product.images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto px-4">
          {product.images.map((src, i) => (
            <button
              key={src + i}
              type="button"
              onClick={() => setImageIndex(i)}
              className={`h-14 w-14 shrink-0 overflow-hidden rounded-md border-2 ${i === imageIndex ? 'border-primary' : 'border-transparent'}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- admin-configured storage host */}
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 px-4">
        <div className="flex flex-wrap items-center gap-2">
          {product.featured && <Badge variant="warning">عرض</Badge>}
          {outOfStock ? <Badge variant="destructive">نفدت الكمية</Badge> : <Badge variant="success">متوفر</Badge>}
        </div>

        <h1 className="text-xl font-semibold">{product.name}</h1>
        {product.shortDescription && <p className="text-sm text-muted-foreground">{product.shortDescription}</p>}

        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-primary">{formatMoney(product.price, product.currency)}</span>
          {hasDiscount && (
            <span className="text-sm text-muted-foreground line-through">
              {formatMoney(product.compareAtPrice!, product.currency)}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 rounded-lg border p-3 text-sm">
          {product.duration && (
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" /> المدة: {product.duration}
            </div>
          )}
          {product.warranty && (
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" /> الضمان: {product.warranty}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-muted-foreground" />
            {autoDelivery ? 'تسليم فوري تلقائي بعد تأكيد الدفع' : 'التسليم بواسطة فريقنا بعد تأكيد الدفع'}
          </div>
        </div>

        {product.description && (
          <>
            <Separator />
            <div>
              <h2 className="mb-1 text-sm font-semibold">تفاصيل المنتج</h2>
              <p className="whitespace-pre-line text-sm text-muted-foreground">{product.description}</p>
            </div>
          </>
        )}

        {product.activationInstructions && (
          <div>
            <h2 className="mb-1 text-sm font-semibold">طريقة التفعيل</h2>
            <p className="whitespace-pre-line text-sm text-muted-foreground">{product.activationInstructions}</p>
          </div>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-16 z-40 border-t bg-background p-3">
        {feedback && (
          <p className={`mb-2 text-center text-xs ${feedback.ok ? 'text-success' : 'text-destructive'}`}>{feedback.text}</p>
        )}
        <div className="flex items-center gap-2">
          {!outOfStock && (
            <div className="flex items-center rounded-md border">
              <button
                type="button"
                className="px-3 py-2 text-sm disabled:opacity-40"
                disabled={quantity >= maxQuantity}
                onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
              >
                +
              </button>
              <span className="w-6 text-center text-sm">{quantity}</span>
              <button
                type="button"
                className="px-3 py-2 text-sm disabled:opacity-40"
                disabled={quantity <= 1}
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              >
                −
              </button>
            </div>
          )}
          <Button className="flex-1" size="lg" disabled={outOfStock} onClick={() => handleAdd(true)}>
            {outOfStock ? 'نفدت الكمية' : 'اشتري الآن'}
          </Button>
          {!outOfStock && (
            <Button size="lg" variant="outline" aria-label="أضف للسلة" onClick={() => handleAdd(false)}>
              <ShoppingCart className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}
