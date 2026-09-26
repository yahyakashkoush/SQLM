'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DELIVERY_TYPES,
  FULFILLMENT_TYPES,
  INVENTORY_MODES,
  PRODUCT_STATUSES,
  PRODUCT_VISIBILITIES,
} from '@sqlm/shared';
import { Badge, Button, Card, CardContent, Input, Label } from '@sqlm/ui';
import { api, ApiError, type AdminProduct } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data-table';

const EMPTY = {
  slug: '',
  name: '',
  shortDescription: '',
  description: '',
  price: '0',
  currency: 'USD',
  stock: 0,
  inventoryMode: 'QUANTITY',
  deliveryType: 'MANUAL',
  fulfillmentType: 'MANUAL_SERVICE',
  status: 'DRAFT',
  visibility: 'HIDDEN',
  categoryId: '',
  duration: '',
  warranty: '',
  images: '',
  compareAtPrice: '',
  tags: '',
  featured: false,
};

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Partial<AdminProduct> | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['products'],
    queryFn: () => api.products('?pageSize=100'),
  });
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: () => api.categories() });

  const close = () => {
    setEditing(null);
    setForm(EMPTY);
    setError(null);
    void queryClient.invalidateQueries({ queryKey: ['products'] });
  };

  const save = useMutation({
    mutationFn: () => {
      const { id: _id, createdAt: _ca, updatedAt: _ua, availableStock: _as, category: _cat, ...rest } = form;
      const payload = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== '' && v !== null && v !== false),
      );
      payload.price = String(payload.price ?? '0');
      payload.stock = Number(payload.stock ?? 0);
      if (typeof payload.images === 'string') {
        payload.images = (payload.images as string).split(',').map((s: string) => s.trim()).filter(Boolean);
      }
      if (typeof payload.tags === 'string') {
        payload.tags = (payload.tags as string).split(',').map((s: string) => s.trim()).filter(Boolean);
      }
      if (payload.compareAtPrice) payload.compareAtPrice = String(payload.compareAtPrice);
      if (form.featured) payload.featured = true;
      return editing?.id ? api.updateProduct(editing.id, payload) : api.createProduct(payload);
    },
    onSuccess: close,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Save failed'),
  });

  const field = (key: string, label: string, type = 'text') => (
    <div className="space-y-1">
      <Label htmlFor={key}>{label}</Label>
      <Input
        id={key}
        type={type}
        value={String(form[key] ?? '')}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </div>
  );

  const select = (key: string, label: string, options: readonly string[]) => (
    <div className="space-y-1">
      <Label htmlFor={key}>{label}</Label>
      <select
        id={key}
        value={String(form[key] ?? '')}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Products"
        description="Everything here is admin-defined — delivery type, fulfillment type and inventory mode are per product, never hardcoded."
        action={
          <Button
            onClick={() => {
              setEditing({});
              setForm(EMPTY);
            }}
          >
            New product
          </Button>
        }
      />

      {editing && (
        <Card className="mb-6">
          <CardContent className="space-y-4 p-4">
            <p className="text-sm font-medium">{editing.id ? 'Edit product' : 'New product'}</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {field('name', 'Name')}
              {field('slug', 'Slug')}
              {field('price', 'Price')}
              {field('currency', 'Currency')}
              {field('stock', 'Stock (QUANTITY mode)', 'number')}
              {select('inventoryMode', 'Inventory mode', INVENTORY_MODES)}
              {select('deliveryType', 'Delivery type', DELIVERY_TYPES)}
              {select('fulfillmentType', 'Fulfillment type', FULFILLMENT_TYPES)}
              {select('status', 'Status', PRODUCT_STATUSES)}
              {select('visibility', 'Visibility', PRODUCT_VISIBILITIES)}
              {field('duration', 'Duration')}
              {field('warranty', 'Warranty')}
              <div className="space-y-1">
                <Label htmlFor="categoryId">Category</Label>
                <select
                  id="categoryId"
                  value={String(form.categoryId ?? '')}
                  onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                  className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                >
                  <option value="">— none —</option>
                  {categories?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {field('shortDescription', 'Short description')}
            {field('description', 'Full description')}
            {field('images', 'Image URLs (comma-separated)')}
            {field('compareAtPrice', 'Compare-at price (original before discount)')}
            {field('tags', 'Tags (comma-separated)')}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(form.featured)}
                onChange={(e) => setForm({ ...form, featured: e.target.checked })}
              />
              Featured product
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
                Save
              </Button>
              <Button size="sm" variant="outline" onClick={close}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <DataTable<AdminProduct>
        rows={data?.items}
        isLoading={isLoading}
        error={loadError}
        empty="No products yet."
        columns={[
          { header: 'Name', cell: (r) => r.name },
          { header: 'Price', cell: (r) => `${r.price} ${r.currency}` },
          {
            header: 'Stock',
            cell: (r) => (
              <span className={r.availableStock <= 3 ? 'text-warning' : undefined}>
                {r.availableStock}
              </span>
            ),
          },
          { header: 'Inventory', cell: (r) => r.inventoryMode },
          { header: 'Delivery', cell: (r) => r.deliveryType },
          {
            header: 'State',
            cell: (r) => (
              <Badge variant={r.status === 'ACTIVE' ? 'success' : 'secondary'}>
                {r.status}/{r.visibility}
              </Badge>
            ),
          },
          {
            header: '',
            cell: (r) => (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditing(r);
                  setForm({
                    ...r,
                    categoryId: r.categoryId ?? '',
                    images: (r.images ?? []).join(', '),
                    tags: (r.tags ?? []).join(', '),
                    compareAtPrice: r.compareAtPrice ?? '',
                    description: r.description ?? '',
                    shortDescription: r.shortDescription ?? '',
                    duration: r.duration ?? '',
                    warranty: r.warranty ?? '',
                  });
                }}
              >
                Edit
              </Button>
            ),
          },
        ]}
      />
    </>
  );
}
