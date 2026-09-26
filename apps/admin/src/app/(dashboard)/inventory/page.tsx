'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, Input } from '@sqlm/ui';
import { api, ApiError, type AdminProduct, type InventoryItem } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data-table';
import { Textarea } from '@/components/form';
import { useAuthStore } from '@/store/auth-store';

export default function InventoryPage() {
  const can = useAuthStore((s) => s.can);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<AdminProduct | null>(null);

  const { data: products, isLoading } = useQuery({
    queryKey: ['products', 'inventory', search],
    queryFn: () => api.products(`?pageSize=100${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}`),
  });
  const current = products?.items.find((p) => p.id === selected?.id) ?? selected;

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Stock for every product. Count-based products get a number; individual-item products hold the actual codes/accounts, delivered automatically."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-2">
          <Input placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <DataTable<AdminProduct>
            rows={products?.items}
            isLoading={isLoading}
            empty="No products."
            onRowClick={setSelected}
            columns={[
              {
                header: 'Product',
                cell: (p) => (
                  <span dir="auto" className={p.id === current?.id ? 'font-semibold text-primary' : 'font-medium'}>
                    {p.name}
                  </span>
                ),
              },
              {
                header: 'Type',
                cell: (p) => (
                  <span className="text-xs text-muted-foreground">
                    {p.inventoryMode === 'INDIVIDUAL' ? 'Individual items' : 'Stock count'}
                  </span>
                ),
              },
              {
                header: 'Available',
                cell: (p) => (
                  <Badge variant={p.availableStock <= 0 ? 'destructive' : p.availableStock <= 3 ? 'warning' : 'secondary'}>
                    {p.availableStock}
                  </Badge>
                ),
              },
            ]}
          />
        </div>

        <div>
          {!current ? (
            <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">Select a product to manage its stock.</p>
          ) : current.inventoryMode === 'QUANTITY' ? (
            <QuantityPanel product={current} canWrite={can('inventory.write')} />
          ) : (
            <ItemsPanel product={current} canWrite={can('inventory.write')} canReveal={can('inventory.reveal_secret')} />
          )}
        </div>
      </div>
    </>
  );
}

function QuantityPanel({ product, canWrite }: { product: AdminProduct; canWrite: boolean }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('10');
  const [error, setError] = useState<string | null>(null);
  const adjust = useMutation({
    mutationFn: (delta: number) => api.adjustStock(product.id, delta),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Update failed'),
  });
  const n = Math.abs(Math.trunc(Number(amount) || 0));

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div>
          <p className="font-medium" dir="auto">{product.name}</p>
          <p className="text-xs text-muted-foreground">
            Stock count — staff deliver each order manually (use a delivery template for the details).
          </p>
        </div>
        <p className="text-3xl font-semibold">{product.availableStock}</p>
        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <Input type="number" min="1" className="w-28" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Button size="sm" disabled={!n || adjust.isPending} onClick={() => adjust.mutate(n)}>
              + Add
            </Button>
            <Button size="sm" variant="outline" disabled={!n || adjust.isPending} onClick={() => adjust.mutate(-n)}>
              − Remove
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={adjust.isPending || product.availableStock === 0}
              onClick={() => adjust.mutate(-product.availableStock)}
            >
              Set to 0 (sold out)
            </Button>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground">
          Want codes/accounts delivered automatically? Edit the product and set Inventory to “Individual items”, then upload them here.
        </p>
      </CardContent>
    </Card>
  );
}

function ItemsPanel({ product, canWrite, canReveal }: { product: AdminProduct; canWrite: boolean; canReveal: boolean }) {
  const queryClient = useQueryClient();
  const [secrets, setSecrets] = useState('');
  const [splitMode, setSplitMode] = useState<'line' | 'blank'>('line');
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('AVAILABLE');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', product.id, status],
    queryFn: () => api.inventory(product.id, `?pageSize=200${status ? `&status=${status}` : ''}`),
  });

  const parsed =
    splitMode === 'line'
      ? secrets.split('\n').map((s) => s.trim()).filter(Boolean)
      : secrets.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);

  const importItems = useMutation({
    mutationFn: () => api.importInventory(product.id, parsed),
    onSuccess: (r) => {
      setSecrets('');
      setError(null);
      setMessage(`Imported ${r.imported} item(s).`);
      void queryClient.invalidateQueries({ queryKey: ['inventory', product.id] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Import failed'),
  });
  const reveal = useMutation({
    mutationFn: (id: string) => api.revealInventory(id),
    onSuccess: (res, id) => setRevealed((prev) => ({ ...prev, [id]: res.secret })),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Reveal failed'),
  });
  const disable = useMutation({
    mutationFn: (id: string) => api.disableInventory(id, 'Disabled by staff'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inventory', product.id] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <p className="font-medium" dir="auto">{product.name}</p>
            <Badge variant="secondary">{product.availableStock} available</Badge>
          </div>
          {canWrite && (
            <>
              <div className="flex gap-3 text-xs">
                <label className="flex items-center gap-1">
                  <input type="radio" checked={splitMode === 'line'} onChange={() => setSplitMode('line')} /> One item per line
                </label>
                <label className="flex items-center gap-1">
                  <input type="radio" checked={splitMode === 'blank'} onChange={() => setSplitMode('blank')} /> Items separated by an empty line (multi-line accounts)
                </label>
              </div>
              <Textarea
                dir="auto"
                rows={6}
                className="font-mono"
                value={secrets}
                onChange={(e) => setSecrets(e.target.value)}
                placeholder={
                  splitMode === 'line'
                    ? 'email@example.com:password\nXXXX-YYYY-ZZZZ'
                    : 'Email: a@example.com\nPassword: 123\n\nEmail: b@example.com\nPassword: 456'
                }
              />
              <Button size="sm" disabled={!parsed.length || importItems.isPending} onClick={() => importItems.mutate()}>
                Import {parsed.length || ''} item(s)
              </Button>
              <p className="text-xs text-muted-foreground">Encrypted at rest; each item is delivered to exactly one customer.</p>
            </>
          )}
          {message && <p className="text-sm text-success">{message}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <div className="flex gap-1">
        {['AVAILABLE', 'RESERVED', 'DELIVERED', 'DISABLED', ''].map((s) => (
          <Button key={s || 'all'} size="sm" variant={status === s ? 'default' : 'outline'} onClick={() => setStatus(s)}>
            {s ? s.toLowerCase() : 'all'}
          </Button>
        ))}
      </div>
      <DataTable<InventoryItem>
        rows={data?.items}
        isLoading={isLoading}
        empty="No items in this state."
        columns={[
          { header: 'Item', cell: (r) => <code className="text-xs">{r.id.slice(0, 8)}</code> },
          {
            header: 'Status',
            cell: (r) => (
              <Badge variant={r.status === 'AVAILABLE' ? 'success' : r.status === 'DISABLED' ? 'destructive' : 'secondary'}>
                {r.status.toLowerCase()}
              </Badge>
            ),
          },
          { header: 'Added', cell: (r) => <span className="text-xs">{new Date(r.createdAt).toLocaleDateString()}</span> },
          {
            header: 'Secret',
            cell: (r) =>
              revealed[r.id] ? (
                <code dir="auto" className="whitespace-pre-wrap text-xs">{revealed[r.id]}</code>
              ) : canReveal ? (
                <Button size="sm" variant="outline" onClick={() => reveal.mutate(r.id)}>
                  Reveal
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">hidden</span>
              ),
          },
          {
            header: '',
            cell: (r) =>
              canWrite && r.status === 'AVAILABLE' ? (
                <Button size="sm" variant="outline" onClick={() => window.confirm('Disable this item?') && disable.mutate(r.id)}>
                  Disable
                </Button>
              ) : null,
          },
        ]}
      />
    </div>
  );
}
