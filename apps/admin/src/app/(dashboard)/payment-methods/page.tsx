'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, Input } from '@sqlm/ui';
import { api, ApiError, type PaymentMethod } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data-table';
import { Checkbox, Field, Select, Textarea } from '@/components/form';
import { ImageUploader } from '@/components/image-uploader';
import { useAuthStore } from '@/store/auth-store';

const CURRENCIES = ['EGP', 'USD', 'SAR', 'AED', 'KWD', 'EUR'];

const PROVIDERS = [
  { value: 'MANUAL', label: 'Manual — you review a receipt' },
  { value: 'BINANCE', label: 'Binance — settles automatically' },
  { value: 'BYBIT', label: 'Bybit — settles automatically' },
];

/** Network codes as the exchanges report them on a deposit record. */
const NETWORKS = ['TRX', 'BSC', 'ETH', 'SOL', 'MATIC', 'ARBITRUM', 'TON'];

interface FormState {
  name: string;
  description: string;
  accountNumber: string;
  instructions: string;
  qrCodeUrl: string[];
  currency: string;
  displayOrder: string;
  enabled: boolean;
  provider: string;
  cryptoAsset: string;
  cryptoNetwork: string;
  depositAddress: string;
  watchTtlMinutes: string;
}

const EMPTY: FormState = {
  name: '',
  description: '',
  accountNumber: '',
  instructions: '',
  qrCodeUrl: [],
  currency: 'EGP',
  displayOrder: '0',
  enabled: true,
  provider: 'MANUAL',
  cryptoAsset: 'USDT',
  cryptoNetwork: 'TRX',
  depositAddress: '',
  watchTtlMinutes: '60',
};

const toForm = (m: PaymentMethod): FormState => ({
  name: m.name,
  description: m.description ?? '',
  accountNumber: m.accountNumber ?? '',
  instructions: m.instructions ?? '',
  qrCodeUrl: m.qrCodeUrl ? [m.qrCodeUrl] : [],
  currency: m.currency,
  displayOrder: String(m.displayOrder),
  enabled: m.enabled,
  provider: m.provider ?? 'MANUAL',
  cryptoAsset: m.cryptoAsset ?? 'USDT',
  cryptoNetwork: m.cryptoNetwork ?? 'TRX',
  depositAddress: m.depositAddress ?? '',
  watchTtlMinutes: String(m.watchTtlMinutes ?? 60),
});

export default function PaymentMethodsPage() {
  const queryClient = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const [editing, setEditing] = useState<PaymentMethod | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const isCryptoForm = form.provider !== 'MANUAL';

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => api.paymentMethods(),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['payment-methods'] });
  const close = () => {
    setEditing(null);
    setForm(EMPTY);
    setError(null);
    refresh();
  };

  const save = useMutation({
    mutationFn: () => {
      // Empty fields are sent as null so clearing a field actually clears it.
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        accountNumber: form.accountNumber.trim() || null,
        instructions: form.instructions.trim() || null,
        qrCodeUrl: form.qrCodeUrl[0] ?? null,
        currency: form.currency.trim().toUpperCase(),
        displayOrder: Number(form.displayOrder || 0),
        enabled: form.enabled,
        provider: form.provider,
        // Only meaningful for an exchange provider; sent as null on a
        // manual method so switching back actually clears them.
        cryptoAsset: isCryptoForm ? form.cryptoAsset.trim().toUpperCase() : null,
        cryptoNetwork: isCryptoForm ? form.cryptoNetwork.trim().toUpperCase() : null,
        depositAddress: isCryptoForm ? form.depositAddress.trim() : null,
        watchTtlMinutes: Number(form.watchTtlMinutes || 60),
      };
      return editing && editing !== 'new' ? api.updatePaymentMethod(editing.id, body) : api.createPaymentMethod(body);
    },
    onSuccess: close,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Save failed'),
  });

  const toggle = useMutation({
    mutationFn: (m: PaymentMethod) => api.updatePaymentMethod(m.id, { enabled: !m.enabled }),
    onSuccess: refresh,
  });

  return (
    <>
      <PageHeader
        title="Payment Methods"
        description="Shown to customers at checkout and on the order page. Changes apply immediately."
        action={
          can('payments.methods.write') && (
            <Button
              onClick={() => {
                setEditing('new');
                setForm(EMPTY);
              }}
            >
              New method
            </Button>
          )
        }
      />

      {editing && (
        <Card className="mb-6">
          <CardContent className="space-y-4 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name *" htmlFor="pm-name">
                <Input id="pm-name" dir="auto" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Vodafone Cash" />
              </Field>
              <Field label="Account number / wallet / IBAN" htmlFor="pm-account" hint="Customers can copy it with one tap.">
                <Input id="pm-account" dir="auto" value={form.accountNumber} onChange={(e) => set('accountNumber', e.target.value)} />
              </Field>
              <Field label="Currency" htmlFor="pm-currency" hint="Informational — every enabled method is offered for every order.">
                <Select
                  id="pm-currency"
                  value={form.currency}
                  onChange={(e) => set('currency', e.target.value)}
                  options={[...new Set([form.currency, ...CURRENCIES])].map((c) => ({ value: c, label: c }))}
                />
              </Field>
              <Field label="Display order" htmlFor="pm-order" hint="Lower numbers show first.">
                <Input id="pm-order" type="number" min="0" value={form.displayOrder} onChange={(e) => set('displayOrder', e.target.value)} />
              </Field>
              <Field label="Short description" htmlFor="pm-desc" className="sm:col-span-2" hint="Shown under the name at checkout.">
                <Input id="pm-desc" dir="auto" value={form.description} onChange={(e) => set('description', e.target.value)} />
              </Field>
              <Field label="Payment instructions" htmlFor="pm-instructions" className="sm:col-span-2" hint="Shown on the order page while the customer pays.">
                <Textarea id="pm-instructions" dir="auto" rows={4} value={form.instructions} onChange={(e) => set('instructions', e.target.value)} />
              </Field>
              <Field label="QR code image (optional)" className="sm:col-span-2">
                <ImageUploader max={1} value={form.qrCodeUrl} onChange={(v) => set('qrCodeUrl', v)} />
                {form.qrCodeUrl.length > 0 && (
                  <button type="button" className="text-xs text-destructive underline" onClick={() => set('qrCodeUrl', [])}>
                    Remove QR code
                  </button>
                )}
              </Field>
            </div>
            <div className="space-y-3 rounded-lg border p-3">
              <Field
                label="Settlement"
                htmlFor="pm-provider"
                hint="An exchange provider confirms the order itself once the deposit lands — no receipt to review."
              >
                <Select
                  id="pm-provider"
                  value={form.provider}
                  onChange={(e) => set('provider', e.target.value)}
                  options={PROVIDERS}
                />
              </Field>

              {isCryptoForm && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Asset *" htmlFor="pm-asset" hint="Ticker as the exchange reports it, e.g. USDT.">
                    <Input
                      id="pm-asset"
                      dir="ltr"
                      value={form.cryptoAsset}
                      onChange={(e) => set('cryptoAsset', e.target.value)}
                      placeholder="USDT"
                    />
                  </Field>
                  <Field label="Network *" htmlFor="pm-network" hint="A deposit on another chain will not settle the order.">
                    <Select
                      id="pm-network"
                      value={form.cryptoNetwork}
                      onChange={(e) => set('cryptoNetwork', e.target.value)}
                      options={[...new Set([form.cryptoNetwork, ...NETWORKS])].map((n) => ({ value: n, label: n }))}
                    />
                  </Field>
                  <Field
                    label="Deposit address *"
                    htmlFor="pm-address"
                    className="sm:col-span-2"
                    hint="Your address on that exchange, for this asset and network."
                  >
                    <Input
                      id="pm-address"
                      dir="ltr"
                      value={form.depositAddress}
                      onChange={(e) => set('depositAddress', e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Payment window (minutes)"
                    htmlFor="pm-ttl"
                    hint="After this the order stops waiting and its amount is reused."
                  >
                    <Input
                      id="pm-ttl"
                      type="number"
                      min="5"
                      value={form.watchTtlMinutes}
                      onChange={(e) => set('watchTtlMinutes', e.target.value)}
                    />
                  </Field>
                  <p className="self-end text-xs text-muted-foreground sm:col-span-1">
                    Each order is given a slightly different amount — that is how a deposit is matched to it.
                  </p>
                </div>
              )}
            </div>

            <Checkbox label="Enabled (offered at checkout)" checked={form.enabled} onChange={(v) => set('enabled', v)} />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" disabled={!form.name.trim() || save.isPending || (isCryptoForm && (!form.cryptoAsset.trim() || !form.depositAddress.trim()))} onClick={() => save.mutate()}>
                {save.isPending ? 'Saving…' : 'Save'}
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
          { header: 'Name', cell: (r) => <span dir="auto" className="font-medium">{r.name}</span> },
          { header: 'Account', cell: (r) => <span dir="auto">{r.accountNumber ?? '—'}</span> },
          { header: 'Currency', cell: (r) => r.currency },
          {
            header: 'Settlement',
            cell: (r) =>
              r.provider && r.provider !== 'MANUAL' ? (
                <Badge variant="success">
                  {r.provider} · {r.cryptoAsset}/{r.cryptoNetwork}
                </Badge>
              ) : (
                <Badge variant="secondary">manual</Badge>
              ),
          },
          {
            header: 'Instructions',
            cell: (r) => (
              <span dir="auto" className="line-clamp-2 max-w-xs text-xs text-muted-foreground">
                {r.instructions ?? '—'}
              </span>
            ),
          },
          { header: 'QR', cell: (r) => (r.qrCodeUrl ? '✓' : '—') },
          {
            header: 'Status',
            cell: (r) => <Badge variant={r.enabled ? 'success' : 'secondary'}>{r.enabled ? 'enabled' : 'disabled'}</Badge>,
          },
          {
            header: '',
            cell: (r) =>
              can('payments.methods.write') && (
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditing(r);
                      setForm(toForm(r));
                      setError(null);
                    }}
                  >
                    Edit
                  </Button>
                  <Button size="sm" variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate(r)}>
                    {r.enabled ? 'Disable' : 'Enable'}
                  </Button>
                </div>
              ),
          },
        ]}
      />
    </>
  );
}
