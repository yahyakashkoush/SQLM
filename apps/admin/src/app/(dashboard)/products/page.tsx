'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, Input } from '@sqlm/ui';
import { api, type AdminProduct } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data-table';
import { Select } from '@/components/form';
import { ProductForm } from '@/components/product-form';
import { useAuthStore } from '@/store/auth-store';

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const [editing, setEditing] = useState<Partial<AdminProduct> | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [flash, setFlash] = useState<string | null>(null);

  const qs = new URLSearchParams({ pageSize: '100' });
  if (search.trim()) qs.set('search', search.trim());
  if (status) qs.set('status', status);
  if (categoryId) qs.set('categoryId', categoryId);

  const { data, isLoading, error } = useQuery({
    queryKey: ['products', qs.toString()],
    queryFn: () => api.products(`?${qs}`),
  });
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: () => api.categories() });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => api.settings() });
  const defaultCurrency = String(
    settings?.settings.find((s) => s.key === 'store.defaultCurrency')?.value ?? 'USD',
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['products'] });
    void queryClient.invalidateQueries({ queryKey: ['stats'] });
  };

  const quickUpdate = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.updateProduct(id, body),
    onSuccess: refresh,
  });
  const archive = useMutation({ mutationFn: (id: string) => api.deleteProduct(id), onSuccess: refresh });

  if (editing) {
    return (
      <>
        <PageHeader
          title={editing.id ? `Edit: ${editing.name}` : 'New product'}
          description="All fields are editable later."
        />
        <ProductForm
          product={editing.id ? editing : null}
          defaultCurrency={defaultCurrency}
          onCancel={() => setEditing(null)}
          onSaved={(result) => {
            setEditing(null);
            setFlash(
              result.notified ? `Saved — announced to ${result.notified} customers.` : 'Saved.',
            );
            refresh();
          }}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Products"
        description="Catalog, prices, images and how each product is delivered."
        action={can('products.write') && <Button onClick={() => setEditing({})}>New product</Button>}
      />

      {flash && (
        <p className="mb-4 rounded-md border border-success/40 bg-success/10 p-2 text-sm">{flash}</p>
      )}

      <Card className="mb-4">
        <CardContent className="grid gap-2 p-3 sm:grid-cols-3">
          <Input placeholder="Search by name…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            placeholder="All categories"
            options={(categories ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="Any status"
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'DRAFT', label: 'Draft' },
              { value: 'ARCHIVED', label: 'Archived' },
            ]}
          />
        </CardContent>
      </Card>

      <DataTable<AdminProduct>
        rows={data?.items}
        isLoading={isLoading}
        error={error}
        empty="No products match."
        onRowClick={can('products.write') ? (p) => setEditing(p) : undefined}
        columns={[
          {
            header: '',
            className: 'w-14',
            cell: (p) =>
              p.images[0] ? (
                // eslint-disable-next-line @next/next/no-img-element -- arbitrary storage hosts
                <img src={p.images[0]} alt="" className="h-10 w-10 rounded object-cover" />
              ) : (
                <div className="h-10 w-10 rounded bg-muted" />
              ),
          },
          {
            header: 'Product',
            cell: (p) => (
              <div dir="auto">
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">{p.category?.name ?? 'No category'}</p>
              </div>
            ),
          },
          {
            header: 'Price',
            cell: (p) => (
              <span>
                {p.price} {p.currency}
                {p.compareAtPrice && (
                  <span className="ml-1 text-xs text-muted-foreground line-through">{p.compareAtPrice}</span>
                )}
              </span>
            ),
          },
          {
            header: 'Stock',
            cell: (p) => (
              <Badge variant={p.availableStock <= 0 ? 'destructive' : p.availableStock <= 3 ? 'warning' : 'secondary'}>
                {p.availableStock} {p.inventoryMode === 'INDIVIDUAL' ? 'items' : ''}
              </Badge>
            ),
          },
          {
            header: 'Delivery',
            cell: (p) => (
              <span className="text-xs text-muted-foreground">
                {p.inventoryMode === 'INDIVIDUAL' && !['MANUAL', 'CUSTOM'].includes(p.deliveryType) ? 'Automatic' : 'Manual'}
                {p.deliveryTemplate ? ` · ${p.deliveryTemplate.name}` : ''}
              </span>
            ),
          },
          {
            header: 'Status',
            cell: (p) => (
              <div className="flex flex-wrap gap-1">
                <Badge variant={p.status === 'ACTIVE' ? 'success' : 'secondary'}>{p.status.toLowerCase()}</Badge>
                {p.visibility === 'HIDDEN' && <Badge variant="outline">hidden</Badge>}
                {p.featured && <Badge variant="warning">featured</Badge>}
              </div>
            ),
          },
          {
            header: '',
            cell: (p) =>
              can('products.write') && (
                <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={quickUpdate.isPending}
                    onClick={() =>
                      quickUpdate.mutate({
                        id: p.id,
                        body: { visibility: p.visibility === 'VISIBLE' ? 'HIDDEN' : 'VISIBLE' },
                      })
                    }
                  >
                    {p.visibility === 'VISIBLE' ? 'Hide' : 'Show'}
                  </Button>
                  {p.status !== 'ARCHIVED' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (window.confirm(`Archive "${p.name}"? It will be hidden from the store.`)) archive.mutate(p.id);
                      }}
                    >
                      Archive
                    </Button>
                  )}
                </div>
              ),
          },
        ]}
      />
      {data && data.total > data.items.length && (
        <p className="mt-2 text-xs text-muted-foreground">
          Showing {data.items.length} of {data.total} — refine the search to find others.
        </p>
      )}
    </>
  );
}
