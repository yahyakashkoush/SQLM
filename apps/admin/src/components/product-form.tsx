'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
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
}

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
      };
      if (form.slug.trim()) payload.slug = form.slug.trim().toLowerCase();
      return (isEdit ? api.updateProduct(product!.id!, payload) : api.createProduct(payload)) as Promise<{
        notified?: number;
      }>;
    },
    onSuccess: (result) => onSaved(result),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Save failed'),
  });

  const validationError = !form.name.trim()
    ? 'Name is required'
    : form.price === '' || Number.isNaN(Number(form.price))
      ? 'Price is required'
      : null;

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
      <div className="flex gap-2">
        <Button disabled={Boolean(validationError) || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create product'}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
