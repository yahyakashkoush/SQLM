'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, Input } from '@sqlm/ui';
import { api, ApiError, type AdminCategory } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data-table';
import { Checkbox, Field, Textarea } from '@/components/form';
import { ImageUploader } from '@/components/image-uploader';
import { useAuthStore } from '@/store/auth-store';

interface FormState {
  name: string;
  description: string;
  image: string[];
  displayOrder: string;
  visible: boolean;
}

const EMPTY: FormState = { name: '', description: '', image: [], displayOrder: '0', visible: true };

export default function CategoriesPage() {
  const queryClient = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const [editing, setEditing] = useState<AdminCategory | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: loadError } = useQuery({ queryKey: ['categories'], queryFn: () => api.categories() });

  const close = () => {
    setEditing(null);
    setForm(EMPTY);
    setError(null);
    void queryClient.invalidateQueries({ queryKey: ['categories'] });
  };

  const open = (c: AdminCategory | 'new') => {
    setEditing(c);
    setError(null);
    setForm(
      c === 'new'
        ? EMPTY
        : {
            name: c.name,
            description: c.description ?? '',
            image: c.image ? [c.image] : [],
            displayOrder: String(c.displayOrder),
            visible: c.status === 'ACTIVE',
          },
    );
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        image: form.image[0] ?? null,
        displayOrder: Number(form.displayOrder || 0),
        status: form.visible ? 'ACTIVE' : 'HIDDEN',
      };
      return editing && editing !== 'new' ? api.updateCategory(editing.id, body) : api.createCategory(body);
    },
    onSuccess: close,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Save failed'),
  });

  return (
    <>
      <PageHeader
        title="Categories"
        description="Group products in the store. Hidden categories disappear from the Mini App."
        action={can('categories.write') && <Button onClick={() => open('new')}>New category</Button>}
      />

      {editing && (
        <Card className="mb-6">
          <CardContent className="space-y-4 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name *" htmlFor="c-name">
                <Input id="c-name" dir="auto" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Display order" htmlFor="c-order" hint="Lower numbers show first.">
                <Input
                  id="c-order"
                  type="number"
                  value={form.displayOrder}
                  onChange={(e) => setForm({ ...form, displayOrder: e.target.value })}
                />
              </Field>
              <Field label="Description" htmlFor="c-desc" className="sm:col-span-2">
                <Textarea
                  id="c-desc"
                  dir="auto"
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </Field>
              <Field label="Image" className="sm:col-span-2">
                <ImageUploader max={1} value={form.image} onChange={(image) => setForm({ ...form, image })} />
              </Field>
            </div>
            <Checkbox label="Visible in the store" checked={form.visible} onChange={(visible) => setForm({ ...form, visible })} />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>
                Save
              </Button>
              <Button size="sm" variant="outline" onClick={close}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <DataTable<AdminCategory>
        rows={data}
        isLoading={isLoading}
        error={loadError}
        empty="No categories yet."
        onRowClick={can('categories.write') ? open : undefined}
        columns={[
          {
            header: '',
            className: 'w-14',
            cell: (c) =>
              c.image ? (
                // eslint-disable-next-line @next/next/no-img-element -- arbitrary storage hosts
                <img src={c.image} alt="" className="h-10 w-10 rounded object-cover" />
              ) : (
                <div className="h-10 w-10 rounded bg-muted" />
              ),
          },
          { header: 'Name', cell: (c) => <span dir="auto" className="font-medium">{c.name}</span> },
          { header: 'Products', cell: (c) => c._count?.products ?? 0 },
          { header: 'Order', cell: (c) => c.displayOrder },
          {
            header: 'Status',
            cell: (c) => (
              <Badge variant={c.status === 'ACTIVE' ? 'success' : 'secondary'}>
                {c.status === 'ACTIVE' ? 'visible' : 'hidden'}
              </Badge>
            ),
          },
        ]}
      />
    </>
  );
}
