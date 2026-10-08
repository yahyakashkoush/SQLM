'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Clock, Package, ShieldCheck, ShoppingCart, Star, Store, Zap } from 'lucide-react';
import { Badge, Button, Separator, Skeleton } from '@sqlm/ui';
import { useProduct, useProfile, useWholesaleBundles } from '@/lib/queries';
import { useCartStore } from '@/store/cart-store';
import { formatMoney } from '@/lib/format';
import { StockLabel } from '@/components/products/stock-label';
import type { ProductBundle } from '@/types/api';

export default function ProductDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const { data: product, isLoading } = useProduct(slug);
  const addItem = useCartStore((s) => s.addItem);
  const [quantity, setQuantity] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  /** null = one unit at a time. */
  const [bundleId, setBundleId] = useState<string | null>(null);
  const { data: profile } = useProfile();
  const { data: wholesaleBundles } = useWholesaleBundles(product?.id, Boolean(profile?.wholesale));

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

  const bundles: ProductBundle[] = [
    ...(product.bundles ?? []),
    ...(wholesaleBundles ?? []).map((b) => ({ ...b, wholesaleOnly: true })),
  ];
  const bundle = bundles.find((b) => b.id === bundleId) ?? null;
  const unitsPer = bundle?.quantity ?? 1;
  const outOfStock = product.availableStock <= 0;
  const maxQuantity = Math.max(1, Math.min(Math.floor(product.availableStock / unitsPer), 50));
  const unitPrice = Number(product.price);
  const linePrice = bundle ? Number(bundle.price) : unitPrice;
  const autoDelivery =
    product.inventoryMode === 'INDIVIDUAL' && !['MANUAL', 'CUSTOM'].includes(product.deliveryType);
  const hasDiscount = product.compareAtPrice && Number(product.compareAtPrice) > Number(product.price);

  const handleAdd = (goToCart: boolean) => {
    const result = addItem(product, quantity, bundle ?? undefined);
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
          {product.badge && <Badge className="bg-primary text-primary-foreground">{product.badge}</Badge>}
          {!product.badge && product.featured && <Badge variant="warning">عرض</Badge>}
          <Badge variant={outOfStock ? 'destructive' : 'outline'}>
            <StockLabel stock={product.availableStock} />
          </Badge>
          {profile?.wholesale && (
            <Badge variant="secondary">
              <Store className="me-1 h-3 w-3" /> تاجر جملة
            </Badge>
          )}
        </div>

        <h1 className="text-xl font-semibold">{product.name}</h1>
        {Number(product.ratingScore) > 0 && (
          <div className="flex items-center gap-1 text-sm text-amber-500" aria-label={`${Number(product.ratingScore).toFixed(1)} من 5`}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={`h-4 w-4 ${i < Math.round(Number(product.ratingScore)) ? 'fill-amber-400' : 'fill-muted stroke-muted-foreground'}`}
              />
            ))}
            <span className="ms-1 font-medium">{Number(product.ratingScore).toFixed(1)}</span>
            {product.reviewCount > 0 && (
              <span className="text-muted-foreground">({product.reviewCount} تقييم)</span>
            )}
          </div>
        )}
        {product.shortDescription && <p className="text-sm text-muted-foreground">{product.shortDescription}</p>}

        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-primary">{formatMoney(product.price, product.currency)}</span>
          {hasDiscount && (
            <span className="text-sm text-muted-foreground line-through">
              {formatMoney(product.compareAtPrice!, product.currency)}
            </span>
          )}
        </div>

        {bundles.length > 0 && !outOfStock && (
          <section aria-label="اختار الكمية" className="space-y-2">
            <h2 className="text-sm font-semibold">اختار الكمية</h2>
            <div className="grid gap-2">
              <OptionRow
                selected={bundleId === null}
                onSelect={() => {
                  setBundleId(null);
                  setQuantity(1);
                }}
                title="قطعة واحدة"
                price={formatMoney(unitPrice, product.currency)}
              />
              {bundles.map((b) => {
                const each = Number(b.price) / b.quantity;
                const saving = unitPrice > 0 ? Math.floor((1 - each / unitPrice) * 100) : 0;
                const fits = b.quantity <= product.availableStock;
                return (
                  <OptionRow
                    key={b.id}
                    disabled={!fits}
                    selected={bundleId === b.id}
                    onSelect={() => {
                      setBundleId(b.id);
                      setQuantity(1);
                    }}
                    title={b.label?.trim() || `باقة ${b.quantity}`}
                    subtitle={`${b.quantity} قطعة · ${formatMoney(each, product.currency)} للقطعة${fits ? '' : ' · الكمية مش كفاية'}`}
                    price={formatMoney(b.price, product.currency)}
                    tag={b.wholesaleOnly ? 'جملة' : saving >= 1 ? `وفّر ${saving}%` : undefined}
                    wholesale={b.wholesaleOnly}
                  />
                );
              })}
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 gap-2 rounded-lg border p-3 text-sm">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <StockLabel stock={product.availableStock} />
          </div>
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
        {!outOfStock && (bundle || quantity > 1) && (
          <p className="mb-2 text-center text-xs text-muted-foreground">
            {quantity * unitsPer} قطعة · الإجمالي {formatMoney(linePrice * quantity, product.currency)}
          </p>
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
              <span className="w-6 text-center text-sm tabular-nums">{quantity}</span>
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

function OptionRow({
  selected,
  onSelect,
  title,
  subtitle,
  price,
  tag,
  wholesale,
  disabled,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  subtitle?: string;
  price: string;
  tag?: string;
  wholesale?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-lg border p-3 text-start transition disabled:opacity-50 ${
        selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:border-primary/40'
      }`}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-primary bg-primary text-primary-foreground' : ''}`}
      >
        {selected && <Check className="h-3 w-3" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium">
          {title}
          {tag && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${wholesale ? 'bg-secondary text-secondary-foreground' : 'bg-success/15 text-success'}`}
            >
              {tag}
            </span>
          )}
        </span>
        {subtitle && <span className="block text-xs text-muted-foreground">{subtitle}</span>}
      </span>
      <span className="shrink-0 text-sm font-semibold tabular-nums">{price}</span>
    </button>
  );
}
