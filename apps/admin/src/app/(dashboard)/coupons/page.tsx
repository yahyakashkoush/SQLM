'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Plus } from 'lucide-react';
import { Badge, Button, Card, CardContent, Input } from '@sqlm/ui';
import { api, ApiError, type Coupon, type CouponInput } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data-table';
import { Field } from '@/components/form';
import { useAuthStore } from '@/store/auth-store';

interface FormState {
  code: string;
  type: 'PERCENT' | 'FIXED';
  value: string;
  minSubtotal: string;
  maxDiscount: string;
  maxRedemptions: string;
  perCustomerLimit: string;
  endsAt: string;
}

/** Empty strings rather than undefined so the inputs stay controlled. */
const BLANK: FormState = {
  code: '',
  type: 'PERCENT',
  value: '',
  minSubtotal: '',
  maxDiscount: '',
  maxRedemptions: '',
  perCustomerLimit: '1',
  endsAt: '',
};

/** "" means "no limit", which the API expects as an absent field, not 0. */
function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export default function CouponsPage() {
  const queryClient = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['coupons'],
    queryFn: () => api.coupons(),
  });

  const save = useMutation({
    mutationFn: () => {
      const f = form!;
      const payload: CouponInput = {
        code: f.code.trim(),
        type: f.type,
        value: Number(f.value),
        minSubtotal: optionalNumber(f.minSubtotal),
        // A ceiling only means anything on a percentage.
        maxDiscount: f.type === 'PERCENT' ? optionalNumber(f.maxDiscount) : undefined,
        maxRedemptions: optionalNumber(f.maxRedemptions),
        perCustomerLimit: optionalNumber(f.perCustomerLimit) ?? 1,
        endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : undefined,
      };
      return api.createCoupon(payload);
    },
    onSuccess: () => {
      setForm(null);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['coupons'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save the coupon'),
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => api.deactivateCoupon(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['coupons'] }),
  });

  return (
    <>
      <PageHeader
        title="Coupons"
        description="Discount codes customers can enter at checkout."
        action={
          can('coupons.write') &&
          !form && (
            <Button size="sm" onClick={() => setForm({ ...BLANK })}>
              <Plus className="h-4 w-4" /> New coupon
            </Button>
          )
        }
      />

      {form && (
        <Card className="mb-6">
          <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
            <Field label="Code">
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="WELCOME10"
                className="font-mono"
              />
            </Field>
            <Field label="Type">
              <div className="flex gap-2">
                {(['PERCENT', 'FIXED'] as const).map((t) => (
                  <Button
                    key={t}
                    type="button"
                    size="sm"
                    variant={form.type === t ? 'default' : 'outline'}
                    onClick={() => setForm({ ...form, type: t })}
                  >
                    {t === 'PERCENT' ? '% off' : 'Fixed amount'}
                  </Button>
                ))}
              </div>
            </Field>
            <Field label={form.type === 'PERCENT' ? 'Percent off (1-100)' : 'Amount off'}>
              <Input
                type="number"
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
              />
            </Field>
            <Field label="Minimum order (optional)">
              <Input
                type="number"
                value={form.minSubtotal}
                onChange={(e) => setForm({ ...form, minSubtotal: e.target.value })}
              />
            </Field>
            {form.type === 'PERCENT' && (
              <Field label="Most it can take off (optional)">
                <Input
                  type="number"
                  value={form.maxDiscount}
                  onChange={(e) => setForm({ ...form, maxDiscount: e.target.value })}
                />
              </Field>
            )}
            <Field label="Total uses (blank = unlimited)">
              <Input
                type="number"
                value={form.maxRedemptions}
                onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value })}
              />
            </Field>
            <Field label="Uses per customer">
              <Input
                type="number"
                value={form.perCustomerLimit}
                onChange={(e) => setForm({ ...form, perCustomerLimit: e.target.value })}
              />
            </Field>
            <Field label="Expires (optional)">
              <Input
                type="date"
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
              />
            </Field>

            <div className="flex items-center gap-2 sm:col-span-2">
              <Button
                disabled={save.isPending || !form.code.trim() || !form.value}
                onClick={() => save.mutate()}
              >
                {save.isPending ? 'Saving…' : 'Create coupon'}
              </Button>
              <Button variant="outline" onClick={() => { setForm(null); setError(null); }}>
                Cancel
              </Button>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          </CardContent>
        </Card>
      )}

      <DataTable<Coupon>
        rows={data}
        isLoading={isLoading}
        error={loadError}
        empty="No coupons yet."
        columns={[
          { header: 'Code', cell: (r) => <span className="font-mono font-semibold">{r.code}</span> },
          {
            header: 'Discount',
            cell: (r) =>
              r.type === 'PERCENT'
                ? `${r.value}%${r.maxDiscount ? ` (max ${r.maxDiscount})` : ''}`
                : r.value,
          },
          { header: 'Min order', cell: (r) => r.minSubtotal ?? '—' },
          {
            header: 'Used',
            cell: (r) => `${r.timesRedeemed}${r.maxRedemptions ? ` / ${r.maxRedemptions}` : ''}`,
          },
          { header: 'Per customer', cell: (r) => r.perCustomerLimit },
          {
            header: 'Expires',
            cell: (r) => (r.endsAt ? new Date(r.endsAt).toLocaleDateString() : 'never'),
          },
          {
            header: 'Status',
            cell: (r) => (
              <Badge variant={r.active ? 'success' : 'secondary'}>
                {r.active ? 'active' : 'off'}
              </Badge>
            ),
          },
          {
            header: '',
            // Deactivated rather than deleted: orders reference the coupon
            // that priced them, and their history has to keep explaining
            // where the discount came from.
            cell: (r) =>
              can('coupons.write') && r.active ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={deactivate.isPending}
                  onClick={() => deactivate.mutate(r.id)}
                >
                  <Ban className="h-3.5 w-3.5" /> Turn off
                </Button>
              ) : null,
          },
        ]}
      />
    </>
  );
}
