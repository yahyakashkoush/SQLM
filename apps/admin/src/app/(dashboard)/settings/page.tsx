'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardContent, Input } from '@sqlm/ui';
import { api, ApiError, type SettingDefinitionRow } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Checkbox, Field, PlaceholderHint, Textarea } from '@/components/form';
import { useAuthStore } from '@/store/auth-store';

const GROUPS: Array<{ key: SettingDefinitionRow['group']; title: string; description: string }> = [
  { key: 'store', title: 'Store', description: 'Basic store identity shown to customers.' },
  {
    key: 'site',
    title: 'Website & terms',
    description: 'The public website (subsc.tech) and the Terms & Conditions shown on the site, in the Mini App and by /terms in the bot.',
  },
  {
    key: 'wholesale',
    title: 'Wholesale',
    description: 'Wholesale membership applications and the terms an applicant must accept.',
  },
  {
    key: 'security',
    title: 'Security & abuse',
    description:
      'The strike ladder: a reused receipt, repeated rejected receipts, too many receipts on one order or too many unpaid orders each count as a strike. Strikes inside the window suspend, suspend longer, then ban. Banned and suspended customers can appeal from the bot.',
  },
  { key: 'pricing', title: 'Pricing & currency', description: 'Prices are in USD; EGP payment methods show the converted amount.' },
  {
    key: 'customers',
    title: 'Customers & loyalty',
    description: 'Verified (مميز) customer discount and the first-order welcome gift for regular customers.',
  },
  { key: 'delivery', title: 'Delivery message', description: 'What the customer receives on Telegram when an item is delivered.' },
  { key: 'orders', title: 'Order messages', description: 'Telegram messages sent when a payment is approved or rejected.' },
  { key: 'bot', title: 'Bot replies', description: 'Texts for /start and the bot menu buttons.' },
];

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const [drafts, setDrafts] = useState<Record<string, unknown>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['settings'], queryFn: () => api.settings() });

  const save = useMutation({
    mutationFn: async (group: string) => {
      const keys = (data?.settings ?? []).filter((s) => s.group === group).map((s) => s.key);
      for (const key of keys) {
        if (key in drafts) await api.updateSetting(key, drafts[key]);
      }
      return group;
    },
    onSuccess: (group) => {
      setError(null);
      setSaved(group);
      setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith(`${group}.`))));
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      setTimeout(() => setSaved(null), 3000);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Save failed'),
  });

  if (isLoading || !data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const readOnly = !can('settings.write');

  const valueOf = (s: SettingDefinitionRow) => (s.key in drafts ? drafts[s.key] : s.value);
  const setValue = (key: string, value: unknown) => setDrafts((d) => ({ ...d, [key]: value }));

  const renderInput = (s: SettingDefinitionRow) => {
    const value = valueOf(s);
    if (s.type === 'boolean') {
      return <Checkbox label={s.label} hint={s.help} checked={Boolean(value)} onChange={(v) => setValue(s.key, v)} />;
    }
    const hint = (
      <>
        {s.help} <PlaceholderHint names={s.placeholders} />
      </>
    );
    return (
      <Field key={s.key} label={s.label} htmlFor={s.key} hint={hint}>
        {s.type === 'textarea' ? (
          <Textarea
            id={s.key}
            dir="auto"
            rows={Math.min(10, Math.max(3, String(value ?? '').split('\n').length + 1))}
            disabled={readOnly}
            value={String(value ?? '')}
            onChange={(e) => setValue(s.key, e.target.value)}
          />
        ) : (
          <Input
            id={s.key}
            dir="auto"
            type={s.type === 'number' ? 'number' : 'text'}
            min={s.min}
            max={s.max}
            step={s.type === 'number' ? 'any' : undefined}
            disabled={readOnly}
            value={String(value ?? '')}
            onChange={(e) => setValue(s.key, s.type === 'number' ? Number(e.target.value) : e.target.value)}
          />
        )}
        {String(value) !== String(s.default) && !readOnly && (
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setValue(s.key, s.default)}>
            Reset to default
          </button>
        )}
      </Field>
    );
  };

  return (
    <>
      <PageHeader title="Settings & content" description="Store details, website content, terms and every customer-facing message. Changes apply within seconds." />
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <nav className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
        {GROUPS.map((g) => (
          <a
            key={g.key}
            href={`#settings-${g.key}`}
            className="whitespace-nowrap rounded-full border px-3 py-1 text-xs hover:bg-accent"
          >
            {g.title}
          </a>
        ))}
      </nav>

      <div className="space-y-6">
        {GROUPS.map((group) => {
          const rows = data.settings.filter((s) => s.group === group.key);
          const dirty = rows.some((s) => s.key in drafts);
          return (
            <Card key={group.key} id={`settings-${group.key}`} className="scroll-mt-20">
              <CardContent className="space-y-4 p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <h2 className="text-sm font-semibold">{group.title}</h2>
                    <p className="text-xs text-muted-foreground">{group.description}</p>
                  </div>
                  {!readOnly && (
                    <div className="flex items-center gap-2">
                      {saved === group.key && <span className="text-xs text-success">Saved ✓</span>}
                      <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate(group.key)}>
                        Save
                      </Button>
                    </div>
                  )}
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  {rows.map((s) => (
                    <div key={s.key} className={s.type === 'textarea' ? 'lg:col-span-2' : undefined}>
                      {renderInput(s)}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {data.custom.length > 0 && (
          <Card>
            <CardContent className="space-y-2 p-4">
              <h2 className="text-sm font-semibold">Other stored values</h2>
              {data.custom.map((c) => (
                <div key={c.key} className="flex flex-col gap-1 text-xs sm:flex-row sm:gap-3">
                  <code className="shrink-0 sm:w-56">{c.key}</code>
                  <code className="break-all text-muted-foreground">{JSON.stringify(c.value)}</code>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
