'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Star, Trash2 } from 'lucide-react';
import { Button, Input } from '@sqlm/ui';
import { api, ApiError, type AdminProduct } from '@/lib/api';
import { Checkbox, Field, Section, Select, Textarea } from './form';
import { ImageUploader } from './image-uploader';

export const DELIVERY_TYPE_LABELS: Record<string, string> = {
  MANUAL: 'Manual — staff delivers after payment',
  ACCOUNT: 'Account credentials',
  LICENSE_KEY: 'License key',
  CODE: 'Redeem code',
  VOUCHER: 'Voucher',
  AUTOMATIC: 'Automatic',
  CUSTOM: 'Custom (manual)',
};

export const FULFILLMENT_TYPE_LABELS: Record<string, string> = {
  ACCOUNT: 'Account',
  SUBSCRIPTION: 'Subscription',
  KEY: 'Key',
  CDK: 'CD key',
  VOUCHER: 'Voucher',
  DIGITAL_FILE: 'Digital file',
  MANUAL_SERVICE: 'Manual service',
  CUSTOM: 'Custom',
};

const CURRENCIES = ['EGP', 'USD', 'SAR', 'AED', 'KWD', 'EUR'];

interface FormState {
  name: string;
  slug: string;
  categoryId: string;
  shortDescription: string;
  description: string;
  tags: string;
  images: string[];
  price: string;
  compareAtPrice: string;
  currency: string;
  duration: string;
  warranty: string;
  inventoryMode: string;
  stock: string;
  deliveryType: string;
  fulfillmentType: string;
  deliveryTemplateId: string;
  activationInstructions: string;
  status: string;
  visible: boolean;
  featured: boolean;
  notifyCustomers: boolean;
  giftType: string;
  maxGiftClaims: string;
  badge: string;
  socialPostUrl: string;
  socialPageUrl: string;
  costPrice: string;
  ratingScore: string;
  reviewCount: string;
}

interface BundleRow {
  id?: string;
  label: string;
  quantity: string;
  price: string;
  wholesaleOnly: boolean;
  active: boolean;
}

const toBundleRows = (p: Partial<AdminProduct> | null): BundleRow[] =>
  (p?.bundles ?? []).map((b) => ({
    id: b.id,
    label: b.label ?? '',
    quantity: String(b.quantity),
    price: String(b.price),
    wholesaleOnly: b.wholesaleOnly,
    active: b.active,
  }));

function toForm(p: Partial<AdminProduct> | null, defaultCurrency: string): FormState {
  return {
    name: p?.name ?? '',
    slug: p?.slug ?? '',
    categoryId: p?.categoryId ?? '',
    shortDescription: p?.shortDescription ?? '',
    description: p?.description ?? '',
    tags: (p?.tags ?? []).join(', '),
    images: p?.images ?? [],
    price: p?.price ?? '',
    compareAtPrice: p?.compareAtPrice ?? '',
    currency: p?.currency ?? defaultCurrency,
    duration: p?.duration ?? '',
    warranty: p?.warranty ?? '',
    inventoryMode: p?.inventoryMode ?? 'QUANTITY',
    stock: String(p?.stock ?? 0),
    deliveryType: p?.deliveryType ?? 'MANUAL',
    fulfillmentType: p?.fulfillmentType ?? 'ACCOUNT',
    deliveryTemplateId: p?.deliveryTemplateId ?? '',
    activationInstructions: p?.activationInstructions ?? '',
    status: p?.status ?? 'ACTIVE',
    visible: p ? p.visibility === 'VISIBLE' : true,
    featured: p?.featured ?? false,
    notifyCustomers: false,
    giftType: p?.giftType ?? '',
    maxGiftClaims: p?.maxGiftClaims != null ? String(p.maxGiftClaims) : '',
    badge: p?.badge ?? '',
    socialPostUrl: p?.socialPostUrl ?? '',
    socialPageUrl: p?.socialPageUrl ?? '',
    costPrice: p?.costPrice ?? '',
    ratingScore: p?.ratingScore != null ? String(Number(p.ratingScore)) : '',
    reviewCount: p?.reviewCount ? String(p.reviewCount) : '',
  };
}

const orNull = (v: string) => (v.trim() === '' ? null : v.trim());

export function ProductForm({
  product,
  defaultCurrency = 'USD',
  onSaved,
  onCancel,
}: {
  product: Partial<AdminProduct> | null;
  defaultCurrency?: string;
  onSaved: (result: { notified?: number }) => void;
  onCancel: () => void;
}) {
  const isEdit = Boolean(product?.id);
  const [form, setForm] = useState<FormState>(() => toForm(product, defaultCurrency));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: () => api.categories() });

  // Bundles live on the product detail, not the list row the form may have
  // been opened from; until they load, saving leaves them untouched.
  const [bundles, setBundles] = useState<BundleRow[]>(() => toBundleRows(product));
  const [bundlesReady, setBundlesReady] = useState(!isEdit || product?.bundles !== undefined);
  const { data: detail } = useQuery({
    queryKey: ['product', product?.id],
    queryFn: () => api.product(product!.id!),
    enabled: isEdit && product?.bundles === undefined,
  });
  useEffect(() => {
    if (detail && !bundlesReady) {
      setBundles(toBundleRows(detail));
      setBundlesReady(true);
    }
  }, [detail, bundlesReady]);
  const setBundle = (i: number, patch: Partial<BundleRow>) =>
    setBundles((rows) => rows.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const { data: templates } = useQuery({ queryKey: ['delivery-templates'], queryFn: () => api.deliveryTemplates() });

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        categoryId: orNull(form.categoryId),
        shortDescription: orNull(form.shortDescription),
        description: orNull(form.description),
        tags: form.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        images: form.images,
        price: Number(form.price),
        compareAtPrice: form.compareAtPrice.trim() ? Number(form.compareAtPrice) : null,
        currency: form.currency.trim().toUpperCase(),
        duration: orNull(form.duration),
        warranty: orNull(form.warranty),
        inventoryMode: form.inventoryMode,
        stock: Number(form.stock || 0),
        deliveryType: form.deliveryType,
        fulfillmentType: form.fulfillmentType,
        deliveryTemplateId: orNull(form.deliveryTemplateId),
        activationInstructions: orNull(form.activationInstructions),
        status: form.status,
        visibility: form.visible ? 'VISIBLE' : 'HIDDEN',
        featured: form.featured,
        notifyCustomers: form.notifyCustomers,
        giftType: form.giftType || null,
        maxGiftClaims: form.giftType && form.maxGiftClaims.trim() ? Number(form.maxGiftClaims) : null,
        badge: form.badge.trim() || null,
        socialPostUrl: form.socialPostUrl.trim() || null,
        socialPageUrl: form.socialPageUrl.trim() || null,
        costPrice: form.costPrice.trim() ? Number(form.costPrice) : null,
        ratingScore: form.ratingScore.trim() ? Number(form.ratingScore) : null,
        reviewCount: form.reviewCount.trim() ? Number(form.reviewCount) : 0,
      };
      if (bundlesReady) {
        payload.bundles = bundles.map((b) => ({
          ...(b.id ? { id: b.id } : {}),
          label: b.label.trim() || null,
          quantity: Number(b.quantity),
          price: Number(b.price),
          wholesaleOnly: b.wholesaleOnly,
          active: b.active,
        }));
      }
      if (form.slug.trim()) payload.slug = form.slug.trim().toLowerCase();
      return (isEdit ? api.updateProduct(product!.id!, payload) : api.createProduct(payload)) as Promise<{
        notified?: number;
      }>;
    },
    onSuccess: (result) => onSaved(result),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Save failed'),
  });

  const badBundle = bundles.find(
    (b) => !(Number(b.quantity) >= 2) || !Number.isInteger(Number(b.quantity)) || !(Number(b.price) > 0),
  );
  const rating = form.ratingScore.trim() ? Number(form.ratingScore) : null;
  const validationError = !form.name.trim()
    ? 'Name is required'
    : form.price === '' || Number.isNaN(Number(form.price))
      ? 'Price is required'
      : rating !== null && (Number.isNaN(rating) || rating < 0 || rating > 5)
        ? 'Rating must be between 0 and 5'
        : badBundle
          ? 'Each bundle needs a quantity of 2 or more and a price'
          : null;
  const unitPrice = Number(form.price) || 0;

  const willAutoDeliver =
    form.inventoryMode === 'INDIVIDUAL' && form.deliveryType !== 'MANUAL' && form.deliveryType !== 'CUSTOM';

  return (
    <div className="space-y-4">
      <Section title="Basics">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name *" htmlFor="p-name">
            <Input id="p-name" dir="auto" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Category" htmlFor="p-category">
            <Select
              id="p-category"
              value={form.categoryId}
              onChange={(e) => set('categoryId', e.target.value)}
              placeholder="— none —"
              options={(categories ?? []).map((c) => ({
                value: c.id,
                label: c.status === 'HIDDEN' ? `${c.name} (hidden)` : c.name,
              }))}
            />
          </Field>
          <Field label="Short description" htmlFor="p-short" hint="One line shown on product cards." className="sm:col-span-2">
            <Input id="p-short" dir="auto" value={form.shortDescription} onChange={(e) => set('shortDescription', e.target.value)} />
          </Field>
          <Field label="Full description" htmlFor="p-desc" className="sm:col-span-2">
            <Textarea id="p-desc" dir="auto" rows={5} value={form.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <Field label="Tags" htmlFor="p-tags" hint="Comma-separated; used by search.">
            <Input id="p-tags" dir="auto" value={form.tags} onChange={(e) => set('tags', e.target.value)} />
          </Field>
          <Field label="URL slug" htmlFor="p-slug" hint="Optional — generated from the name if empty.">
            <Input id="p-slug" value={form.slug} onChange={(e) => set('slug', e.target.value)} placeholder="netflix-1-month" />
          </Field>
        </div>
      </Section>

      <Section title="Images" description="Upload from your computer. The first image is the cover shown in the store.">
        <ImageUploader value={form.images} onChange={(urls) => set('images', urls)} />
      </Section>

      <Section title="Pricing">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Price *" htmlFor="p-price">
            <Input id="p-price" type="number" min="0" step="0.01" value={form.price} onChange={(e) => set('price', e.target.value)} />
          </Field>
          <Field label="Compare-at price" htmlFor="p-compare" hint="Shown crossed out.">
            <Input id="p-compare" type="number" min="0" step="0.01" value={form.compareAtPrice} onChange={(e) => set('compareAtPrice', e.target.value)} />
          </Field>
          <Field label="Currency" htmlFor="p-currency">
            <Select
              id="p-currency"
              value={form.currency}
              onChange={(e) => set('currency', e.target.value)}
              options={[...new Set([form.currency, ...CURRENCIES])].map((c) => ({ value: c, label: c }))}
            />
          </Field>
          <Field label="Duration" htmlFor="p-duration" hint="e.g. شهر / 3 months">
            <Input id="p-duration" dir="auto" value={form.duration} onChange={(e) => set('duration', e.target.value)} />
          </Field>
          <Field label="Warranty" htmlFor="p-warranty" hint="e.g. ضمان كامل المدة">
            <Input id="p-warranty" dir="auto" value={form.warranty} onChange={(e) => set('warranty', e.target.value)} />
          </Field>
          <Field label="Cost price (private)" htmlFor="p-cost" hint="For profit reports. Never shown to customers.">
            <Input id="p-cost" type="number" min="0" step="0.01" value={form.costPrice} onChange={(e) => set('costPrice', e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section
        title="Bundles"
        description="Sell several units together for less — e.g. 5 accounts for the price of 4. Wholesale bundles are only offered to approved wholesale members."
      >
        {!bundlesReady ? (
          <p className="text-sm text-muted-foreground">Loading bundles…</p>
        ) : (
          <div className="space-y-3">
            {bundles.length === 0 && <p className="text-sm text-muted-foreground">No bundles — sold one unit at a time.</p>}
            {bundles.map((b, i) => {
              const qty = Number(b.quantity);
              const price = Number(b.price);
              const saving = qty >= 2 && price > 0 && unitPrice > 0 ? 1 - price / (unitPrice * qty) : null;
              return (
                <div key={b.id ?? `new-${i}`} className="rounded-lg border p-3">
                  <div className="grid gap-3 sm:grid-cols-[1fr,7rem,8rem]">
                    <Field label="Label" htmlFor={`b-label-${i}`} hint="Shown to the customer.">
                      <Input
                        id={`b-label-${i}`}
                        dir="auto"
                        value={b.label}
                        placeholder={`باقة ${b.quantity || 'N'}`}
                        onChange={(e) => setBundle(i, { label: e.target.value })}
                      />
                    </Field>
                    <Field label="Units" htmlFor={`b-qty-${i}`}>
                      <Input
                        id={`b-qty-${i}`}
                        type="number"
                        min="2"
                        inputMode="numeric"
                        value={b.quantity}
                        onChange={(e) => setBundle(i, { quantity: e.target.value })}
                      />
                    </Field>
                    <Field label={`Price (${form.currency})`} htmlFor={`b-price-${i}`} hint="For the whole bundle.">
                      <Input
                        id={`b-price-${i}`}
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={b.price}
                        onChange={(e) => setBundle(i, { price: e.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                    <Checkbox label="Wholesale members only" checked={b.wholesaleOnly} onChange={(v) => setBundle(i, { wholesaleOnly: v })} />
                    <Checkbox label="Active" checked={b.active} onChange={(v) => setBundle(i, { active: v })} />
                    {saving !== null && (
                      <span className={`text-xs ${saving > 0 ? 'text-success' : 'text-destructive'}`}>
                        {saving > 0
                          ? `${Math.round(saving * 100)}% off ${qty} singles · ${(price / qty).toFixed(2)} each`
                          : 'Costs more than buying singles'}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setBundles((rows) => rows.filter((_, j) => j !== i))}
                      className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Remove
                    </button>
                  </div>
                </div>
              );
            })}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setBundles((rows) => [
                  ...rows,
                  { label: '', quantity: '5', price: '', wholesaleOnly: false, active: true },
                ])
              }
            >
              <Plus className="mr-1 h-4 w-4" /> Add bundle
            </Button>
          </div>
        )}
      </Section>

      <Section title="Star rating" description="The stars and count shown on the product. Stars only — no written reviews are shown.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Rating (0–5)" htmlFor="p-rating" hint="Leave empty to hide the stars.">
            <Input
              id="p-rating"
              type="number"
              min="0"
              max="5"
              step="0.1"
              inputMode="decimal"
              value={form.ratingScore}
              onChange={(e) => set('ratingScore', e.target.value)}
              placeholder="4.9"
            />
          </Field>
          <Field label="Number of ratings" htmlFor="p-reviews">
            <Input
              id="p-reviews"
              type="number"
              min="0"
              inputMode="numeric"
              value={form.reviewCount}
              onChange={(e) => set('reviewCount', e.target.value)}
              placeholder="320"
            />
          </Field>
          {rating !== null && !Number.isNaN(rating) && (
            <div className="flex items-center gap-1 sm:col-span-2" aria-label={`Preview: ${rating} stars`}>
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={`h-5 w-5 ${i < Math.round(rating) ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40'}`}
                />
              ))}
              <span className="ml-1 text-sm font-medium">{rating.toFixed(1)}</span>
              {form.reviewCount && <span className="text-sm text-muted-foreground">({form.reviewCount})</span>}
            </div>
          )}
        </div>
      </Section>

      <Section title="Stock & delivery">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Inventory"
            htmlFor="p-inv"
            hint={
              form.inventoryMode === 'INDIVIDUAL'
                ? 'Upload each code/account under Inventory; stock = items available.'
                : 'Just a stock number — staff delivers each order.'
            }
          >
            <Select
              id="p-inv"
              value={form.inventoryMode}
              onChange={(e) => set('inventoryMode', e.target.value)}
              options={[
                { value: 'QUANTITY', label: 'Stock count' },
                { value: 'INDIVIDUAL', label: 'Individual items (codes / accounts)' },
              ]}
            />
          </Field>
          {form.inventoryMode === 'QUANTITY' && (
            <Field label="Stock" htmlFor="p-stock">
              <Input id="p-stock" type="number" min="0" value={form.stock} onChange={(e) => set('stock', e.target.value)} />
            </Field>
          )}
          <Field label="Delivery type" htmlFor="p-delivery">
            <Select
              id="p-delivery"
              value={form.deliveryType}
              onChange={(e) => set('deliveryType', e.target.value)}
              options={Object.entries(DELIVERY_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </Field>
          <Field label="Product type" htmlFor="p-fulfillment">
            <Select
              id="p-fulfillment"
              value={form.fulfillmentType}
              onChange={(e) => set('fulfillmentType', e.target.value)}
              options={Object.entries(FULFILLMENT_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </Field>
          <Field
            label="Delivery template"
            htmlFor="p-template"
            hint="Pre-fills the staff delivery form (e.g. Email / Password)."
          >
            <Select
              id="p-template"
              value={form.deliveryTemplateId}
              onChange={(e) => set('deliveryTemplateId', e.target.value)}
              placeholder="— none —"
              options={(templates ?? []).map((t) => ({ value: t.id, label: t.name }))}
            />
          </Field>
          <p className="self-end rounded bg-muted p-2 text-xs text-muted-foreground">
            {willAutoDeliver
              ? '⚡ Delivered automatically from inventory as soon as payment is approved.'
              : '👤 Staff delivers each order from the Deliveries page or the order page.'}
          </p>
          <Field
            label="Activation instructions"
            htmlFor="p-instructions"
            hint="Added to the customer's delivery message."
            className="sm:col-span-2"
          >
            <Textarea
              id="p-instructions"
              dir="auto"
              rows={3}
              value={form.activationInstructions}
              onChange={(e) => set('activationInstructions', e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="Gift & Badge"
        description="Set a gift type to make this product claimable for free. Badge shows a label on the product card."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Gift type" htmlFor="p-gifttype">
            <Select
              id="p-gifttype"
              value={form.giftType}
              onChange={(e) => set('giftType', e.target.value)}
              placeholder="— not a gift —"
              options={[
                { value: 'INSTANT_FREE', label: 'Instant Free — claim immediately, auto-delivered' },
                { value: 'SOCIAL_REWARD', label: 'Social Reward — comment/rate Facebook, staff approves' },
              ]}
            />
          </Field>
          {form.giftType && (
            <Field label="Max claims" htmlFor="p-maxclaims" hint="Total gifts available. Leave blank for unlimited.">
              <Input
                id="p-maxclaims"
                type="number"
                min="1"
                value={form.maxGiftClaims}
                onChange={(e) => set('maxGiftClaims', e.target.value)}
                placeholder="e.g. 50"
              />
            </Field>
          )}
          {form.giftType === 'SOCIAL_REWARD' && (
            <>
              <Field label="Facebook post URL" htmlFor="p-socialpost" hint="Customers will be asked to comment on this post." className="sm:col-span-2">
                <Input
                  id="p-socialpost"
                  type="url"
                  dir="ltr"
                  value={form.socialPostUrl}
                  onChange={(e) => set('socialPostUrl', e.target.value)}
                  placeholder="https://facebook.com/..."
                />
              </Field>
              <Field label="Facebook page URL" htmlFor="p-socialpage" hint="Customers will be asked to rate this page." className="sm:col-span-2">
                <Input
                  id="p-socialpage"
                  type="url"
                  dir="ltr"
                  value={form.socialPageUrl}
                  onChange={(e) => set('socialPageUrl', e.target.value)}
                  placeholder="https://facebook.com/..."
                />
              </Field>
            </>
          )}
          <Field label="Badge" htmlFor="p-badge" hint="Short label on the product card (NEW, BESTSELLER, LIMITED, EXCLUSIVE or custom)">
            <Input
              id="p-badge"
              dir="auto"
              value={form.badge}
              onChange={(e) => set('badge', e.target.value)}
              placeholder="e.g. NEW"
            />
          </Field>
        </div>
      </Section>

      <Section title="Publishing">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Status" htmlFor="p-status">
            <Select
              id="p-status"
              value={form.status}
              onChange={(e) => set('status', e.target.value)}
              options={[
                { value: 'ACTIVE', label: 'Active — can be bought' },
                { value: 'DRAFT', label: 'Draft' },
                { value: 'ARCHIVED', label: 'Archived' },
              ]}
            />
          </Field>
          <div className="space-y-2 pt-1">
            <Checkbox label="Visible in the store" checked={form.visible} onChange={(v) => set('visible', v)} />
            <Checkbox label="Featured (shown in Offers)" checked={form.featured} onChange={(v) => set('featured', v)} />
            <Checkbox
              label="Notify all customers on Telegram"
              hint="Sends the product with its image and a Buy button. Only for active, visible products."
              checked={form.notifyCustomers}
              onChange={(v) => set('notifyCustomers', v)}
            />
          </div>
        </div>
      </Section>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {!error && validationError && <p className="text-sm text-muted-foreground">{validationError}</p>}
      <div className="sticky bottom-0 -mx-1 flex gap-2 border-t bg-background/95 px-1 py-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0">
        <Button className="flex-1 sm:flex-none" disabled={Boolean(validationError) || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create product'}
        </Button>
        <Button className="flex-1 sm:flex-none" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
