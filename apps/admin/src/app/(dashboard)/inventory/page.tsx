'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent } from '@sqlm/ui';
import { api, ApiError, type InventoryItem } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data-table';
import { useAuthStore } from '@/store/auth-store';

export default function InventoryPage() {
  const queryClient = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const [productId, setProductId] = useState('');
  const [secrets, setSecrets] = useState('');
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: () => api.products('?pageSize=100'),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', productId],
    queryFn: () => api.inventory(productId, '?pageSize=100'),
    enabled: Boolean(productId),
  });

  const importItems = useMutation({
    mutationFn: () =>
      api.importInventory(
        productId,
        secrets
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    onSuccess: () => {
      setSecrets('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['inventory', productId] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Import failed'),
  });

  const reveal = useMutation({
    mutationFn: (id: string) => api.revealInventory(id),
    onSuccess: (res, id) => setRevealed((prev) => ({ ...prev, [id]: res.secret })),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Reveal failed'),
  });

  const individualProducts = products?.items.filter((p) => p.inventoryMode === 'INDIVIDUAL') ?? [];

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Individual items only. Secrets are encrypted at rest; revealing one is a separate, audited permission."
      />

      <Card className="mb-6">
        <CardContent className="space-y-3 p-4">
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="h-9 w-full max-w-md rounded-md border bg-transparent px-2 text-sm"
          >
            <option value="">— select a product —</option>
            {individualProducts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.availableStock} available)
              </option>
            ))}
          </select>

          {productId && can('inventory.write') && (
            <>
              <textarea
                value={secrets}
                onChange={(e) => setSecrets(e.target.value)}
                rows={5}
                placeholder="One secret per line — account credentials, license keys, voucher codes…"
                className="w-full rounded-md border bg-transparent p-2 text-sm"
              />
              <Button
                size="sm"
                disabled={!secrets.trim() || importItems.isPending}
                onClick={() => importItems.mutate()}
              >
                Import items
              </Button>
            </>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {productId && (
        <DataTable<InventoryItem>
          rows={data?.items}
          isLoading={isLoading}
          empty="No inventory items for this product."
          columns={[
            { header: 'Item', cell: (r) => r.id.slice(0, 8) },
            {
              header: 'Status',
              cell: (r) => (
                <Badge
                  variant={
                    r.status === 'AVAILABLE'
                      ? 'success'
                      : r.status === 'DELIVERED'
                        ? 'secondary'
                        : 'warning'
                  }
                >
                  {r.status}
                </Badge>
              ),
            },
            { header: 'Order', cell: (r) => (r.orderId ? r.orderId.slice(0, 8) : '—') },
            { header: 'Added', cell: (r) => new Date(r.createdAt).toLocaleDateString() },
            {
              header: 'Secret',
              cell: (r) =>
                revealed[r.id] ? (
                  <code className="text-xs">{revealed[r.id]}</code>
                ) : can('inventory.reveal_secret') ? (
                  <Button size="sm" variant="outline" onClick={() => reveal.mutate(r.id)}>
                    Reveal
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">hidden</span>
                ),
            },
          ]}
        />
      )}
    </>
  );
}
