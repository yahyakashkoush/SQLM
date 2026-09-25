'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, Input, Label } from '@sqlm/ui';
import { api, ApiError, type PaymentMethod } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data-table';

const EMPTY = {
  name: '',
  description: '',
  accountNumber: '',
  instructions: '',
  currency: 'USD',
  enabled: true,
  displayOrder: 0,
};

export default function PaymentMethodsPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Partial<PaymentMethod> | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => api.paymentMethods(),
  });

  const close = () => {
    setEditing(null);
    setForm(EMPTY);
    setError(null);
    void queryClient.invalidateQueries({ queryKey: ['payment-methods'] });
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = Object.fromEntries(
        Object.entries(form).filter(([, v]) => v !== '' && v !== null),
      );
      payload.displayOrder = Number(payload.displayOrder ?? 0);
      return editing?.id ? api.updatePaymentMethod(editing.id, payload) : api.createPaymentMethod(payload);
    },
    onSuccess: close,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Save failed'),
  });

  // Never hard-deleted: orders reference methods historically, so "delete"
  // disables instead (the API enforces this too).
  const disable = useMutation({
    mutationFn: (id: string) => api.deletePaymentMethod(id),
    onSuccess: close,
  });

  const field = (key: string, label: string) => (
    <div className="space-y-1">
      <Label htmlFor={key}>{label}</Label>
      <Input
        id={key}
        value={String(form[key] ?? '')}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <>
      <PageHeader
        title="Payment Methods"
        description="What customers can pay with. Fully admin-defined, including currency and instructions."
        action={
          <Button
            onClick={() => {
              setEditing({});
              setForm(EMPTY);
            }}
          >
            New method
          </Button>
        }
      />

      {editing && (
        <Card className="mb-6">
          <CardContent className="space-y-4 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {field('name', 'Name')}
              {field('currency', 'Currency')}
              {field('accountNumber', 'Account number / wallet')}
              {field('displayOrder', 'Display order')}
              {field('description', 'Description')}
              {field('instructions', 'Payment instructions')}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(form.enabled)}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              Enabled (visible to customers at checkout)
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

      <DataTable<PaymentMethod>
        rows={data}
        isLoading={isLoading}
        error={loadError}
        empty="No payment methods configured."
        columns={[
          { header: 'Name', cell: (r) => r.name },
          { header: 'Currency', cell: (r) => r.currency },
          { header: 'Account', cell: (r) => r.accountNumber ?? '—' },
          {
            header: 'Enabled',
            cell: (r) => (
              <Badge variant={r.enabled ? 'success' : 'secondary'}>{r.enabled ? 'yes' : 'no'}</Badge>
            ),
          },
          {
            header: '',
            cell: (r) => (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(r);
                    setForm({ ...r });
                  }}
                >
                  Edit
                </Button>
                {r.enabled && (
                  <Button size="sm" variant="outline" onClick={() => disable.mutate(r.id)}>
                    Disable
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />
    </>
  );
}
