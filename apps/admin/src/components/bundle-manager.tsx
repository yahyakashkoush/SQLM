'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Plus, Store, Trash2, Users } from 'lucide-react';
import { Button, Input } from '@sqlm/ui';
import { api, ApiError, type BundleInput, type SavedBundle } from '@/lib/api';
import { Checkbox, Field } from './form';

/** What a bundle row edits; numbers stay strings until they are sent. */
export interface BundleDraft {
  label: string;
  quantity: string;
  price: string;
  wholesaleOnly: boolean;
  active: boolean;
}

export const emptyBundle = (wholesaleOnly = false): BundleDraft => ({
  label: '',
  quantity: wholesaleOnly ? '10' : '5',
  price: '',
  wholesaleOnly,
  active: true,
});

const fromSaved = (b: SavedBundle): BundleDraft => ({
  label: b.label ?? '',
  quantity: String(b.quantity),
  price: String(Number(b.price)),
  wholesaleOnly: b.wholesaleOnly,
  active: b.active,
});

export const toInput = (d: BundleDraft): BundleInput => ({
  label: d.label.trim() || null,
  quantity: Number(d.quantity),
  price: Number(d.price),
  wholesaleOnly: d.wholesaleOnly,
  active: d.active,
});

export function bundleProblem(d: BundleDraft): string | null {
  const qty = Number(d.quantity);
  if (!Number.isInteger(qty) || qty < 2) return 'Units must be a whole number, 2 or more';
  if (!(Number(d.price) > 0)) return 'Enter the price of the whole bundle';
  return null;
}

const same = (a: BundleDraft, b: BundleDraft) =>
  a.label.trim() === b.label.trim() &&
  Number(a.quantity) === Number(b.quantity) &&
  Number(a.price) === Number(b.price) &&
  a.wholesaleOnly === b.wholesaleOnly &&
  a.active === b.active;

const errorText = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Could not save — try again';

interface Pricing {
  currency: string;
  unitPrice: number;
  costPrice: number | null;
}

/**
 * Bundles of a saved product. Every add, edit and delete goes to the
 * server on its own and the list is always the server's answer — there is
 * no "save the whole list" step that could drop rows this screen did not
 * know about.
 */
export function BundleManager({ productId, pricing }: { productId: string; pricing: Pricing }) {
  const queryClient = useQueryClient();
  const key = ['product-bundles', productId];
  const {
    data: bundles,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: key,
    queryFn: () => api.productBundles(productId),
    staleTime: 0,
    gcTime: 0,
  });
  const [adding, setAdding] = useState<BundleDraft | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const settle = (next: SavedBundle[]) => {
    queryClient.setQueryData(key, next);
    void queryClient.invalidateQueries({ queryKey: ['product', productId] });
  };

  const add = useMutation({
    mutationFn: (draft: BundleDraft) => api.addBundle(productId, toInput(draft)),
    onSuccess: (res) => {
      settle(res.bundles);
      setAdding(null);
      setAddError(null);
    },
    onError: (err) => setAddError(errorText(err)),
  });

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading bundles…
      </p>
    );
  }
  if (isError || !bundles) {
    return (
      <div className="flex items-center gap-3 text-sm text-destructive">
        Couldn&apos;t load bundles.
        <Button type="button" size="sm" variant="outline" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const retail = bundles.filter((b) => !b.wholesaleOnly);
  const wholesale = bundles.filter((b) => b.wholesaleOnly);

  return (
    <div className="space-y-5">
      <BundleGroup
        icon={<Users className="h-4 w-4" />}
        title="Everyone"
        empty="No retail bundles — customers buy one unit at a time."
        rows={retail}
        productId={productId}
        pricing={pricing}
        onSettled={settle}
      />
      <BundleGroup
        icon={<Store className="h-4 w-4" />}
        title="Wholesale members only"
        empty="No wholesale prices yet — approved merchants see the retail options."
        rows={wholesale}
        productId={productId}
        pricing={pricing}
        onSettled={settle}
      />

      {adding ? (
        <div className="rounded-lg border border-dashed border-primary/50 bg-primary/5 p-3">
          <p className="mb-2 text-sm font-medium">New bundle</p>
          <BundleFields draft={adding} onChange={setAdding} pricing={pricing} idPrefix="new" />
          {addError && <p className="mt-2 text-sm text-destructive">{addError}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={add.isPending || Boolean(bundleProblem(adding))}
              onClick={() => add.mutate(adding)}
            >
              {add.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-1 h-4 w-4" />
              )}
              Add bundle
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => (setAdding(null), setAddError(null))}
            >
              Cancel
            </Button>
            {bundleProblem(adding) && (
              <span className="self-center text-xs text-muted-foreground">
                {bundleProblem(adding)}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAdding(emptyBundle(false))}
          >
            <Plus className="mr-1 h-4 w-4" /> Retail bundle
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAdding(emptyBundle(true))}
          >
            <Plus className="mr-1 h-4 w-4" /> Wholesale price
          </Button>
        </div>
      )}
    </div>
  );
}

function BundleGroup({
  icon,
  title,
  empty,
  rows,
  productId,
  pricing,
  onSettled,
}: {
  icon: React.ReactNode;
  title: string;
  empty: string;
  rows: SavedBundle[];
  productId: string;
  pricing: Pricing;
  onSettled: (next: SavedBundle[]) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon} {title} <span className="font-normal normal-case">({rows.length})</span>
      </p>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        rows.map((b) => (
          <SavedBundleRow
            key={b.id}
            bundle={b}
            productId={productId}
            pricing={pricing}
            onSettled={onSettled}
          />
        ))
      )}
    </div>
  );
}

function SavedBundleRow({
  bundle,
  productId,
  pricing,
  onSettled,
}: {
  bundle: SavedBundle;
  productId: string;
  pricing: Pricing;
  onSettled: (next: SavedBundle[]) => void;
}) {
  const saved = fromSaved(bundle);
  const [draft, setDraft] = useState<BundleDraft>(saved);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty = !same(draft, saved);
  const problem = bundleProblem(draft);

  const save = useMutation({
    mutationFn: () => api.updateBundle(productId, bundle.id, toInput(draft)),
    onSuccess: (res) => {
      setError(null);
      onSettled(res.bundles);
    },
    onError: (err) => setError(errorText(err)),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteBundle(productId, bundle.id),
    onSuccess: (res) => onSettled(res.bundles),
    onError: (err) => {
      setConfirmDelete(false);
      setError(errorText(err));
    },
  });

  return (
    <div className={`rounded-lg border p-3 ${bundle.active ? '' : 'opacity-70'}`}>
      <BundleFields draft={draft} onChange={setDraft} pricing={pricing} idPrefix={bundle.id} />
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {dirty ? (
          <>
            <Button
              type="button"
              size="sm"
              disabled={save.isPending || Boolean(problem)}
              onClick={() => save.mutate()}
            >
              {save.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-1 h-4 w-4" />
              )}
              Save changes
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => (setDraft(saved), setError(null))}
            >
              Undo
            </Button>
            {problem && <span className="text-xs text-muted-foreground">{problem}</span>}
          </>
        ) : (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="h-3.5 w-3.5 text-success" /> Saved
          </span>
        )}
        <div className="ml-auto">
          {confirmDelete ? (
            <span className="flex items-center gap-2">
              <span className="text-xs">Delete this bundle?</span>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                {remove.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setConfirmDelete(false)}
              >
                Keep
              </Button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The inputs of one bundle plus what it works out to per unit. */
export function BundleFields({
  draft,
  onChange,
  pricing,
  idPrefix,
}: {
  draft: BundleDraft;
  onChange: (next: BundleDraft) => void;
  pricing: Pricing;
  idPrefix: string;
}) {
  const set = (patch: Partial<BundleDraft>) => onChange({ ...draft, ...patch });
  const qty = Number(draft.quantity);
  const price = Number(draft.price);
  const each = qty >= 2 && price > 0 ? price / qty : null;
  const saving = each !== null && pricing.unitPrice > 0 ? 1 - each / pricing.unitPrice : null;
  const profitEach = each !== null && pricing.costPrice !== null ? each - pricing.costPrice : null;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-[1fr,7rem,8rem]">
        <Field label="Label" htmlFor={`b-label-${idPrefix}`} hint="Shown to the customer.">
          <Input
            id={`b-label-${idPrefix}`}
            dir="auto"
            value={draft.label}
            placeholder={`${draft.wholesaleOnly ? 'جملة' : 'باقة'} ${draft.quantity || 'N'}`}
            onChange={(e) => set({ label: e.target.value })}
          />
        </Field>
        <Field label="Units" htmlFor={`b-qty-${idPrefix}`}>
          <Input
            id={`b-qty-${idPrefix}`}
            type="number"
            min="2"
            inputMode="numeric"
            value={draft.quantity}
            onChange={(e) => set({ quantity: e.target.value })}
          />
        </Field>
        <Field
          label={`Price (${pricing.currency})`}
          htmlFor={`b-price-${idPrefix}`}
          hint="For the whole bundle."
        >
          <Input
            id={`b-price-${idPrefix}`}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={draft.price}
            onChange={(e) => set({ price: e.target.value })}
          />
        </Field>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <Checkbox
          label="Wholesale members only"
          checked={draft.wholesaleOnly}
          onChange={(v) => set({ wholesaleOnly: v })}
        />
        <Checkbox label="Active" checked={draft.active} onChange={(v) => set({ active: v })} />
        {each !== null && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {each.toFixed(2)} each
            {saving !== null &&
              (saving > 0 ? (
                <span className="text-success"> · {Math.round(saving * 100)}% off singles</span>
              ) : (
                <span className="text-destructive"> · costs more than singles</span>
              ))}
            {profitEach !== null && (
              <span className={profitEach >= 0 ? '' : 'text-destructive'}>
                {' '}
                · profit {profitEach.toFixed(2)}/unit
              </span>
            )}
          </span>
        )}
      </div>
    </>
  );
}
