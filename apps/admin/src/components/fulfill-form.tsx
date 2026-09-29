'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input } from '@sqlm/ui';
import { api, ApiError, type PendingDelivery } from '@/lib/api';
import { Field, Select, Textarea } from './form';

/**
 * Staff delivery form. Pre-fills from the product's delivery template so
 * the agent fills in blanks ("Email: …") instead of typing a layout; the
 * result is encrypted at rest and sent to the customer with the store's
 * delivery message.
 */
export function FulfillForm({
  delivery,
  mode = 'fulfill',
  onDone,
  onCancel,
}: {
  delivery: PendingDelivery;
  mode?: 'fulfill' | 'replace';
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: templates } = useQuery({ queryKey: ['delivery-templates'], queryFn: () => api.deliveryTemplates() });
  const productTemplateId = delivery.orderItem.product?.deliveryTemplateId ?? '';
  const [templateId, setTemplateId] = useState(productTemplateId);
  const [content, setContent] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!templates || content) return;
    const t = templates.find((x) => x.id === (templateId || productTemplateId));
    if (t) setContent(t.content);
    // Only on first load of templates — later edits must not be overwritten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates]);

  const submit = useMutation({
    mutationFn: () =>
      mode === 'replace'
        ? api.replaceDelivery(delivery.id, content, note || undefined)
        : api.fulfillDelivery(delivery.id, content, note || undefined),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      void queryClient.invalidateQueries({ queryKey: ['order'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      onDone?.();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Delivery failed'),
  });

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates?.find((x) => x.id === id);
    if (t && (!content.trim() || window.confirm('Replace the current text with this template?'))) {
      setContent(t.content);
    }
  };

  return (
    <div className="space-y-3">
      <Field label="Template" hint="Manage templates under Delivery Templates.">
        <Select
          value={templateId}
          onChange={(e) => applyTemplate(e.target.value)}
          placeholder="— no template —"
          options={(templates ?? []).map((t) => ({ value: t.id, label: t.name }))}
        />
      </Field>
      <Field
        label={`Details for ${delivery.orderItem.productNameSnapshot} × ${delivery.orderItem.quantity}`}
        hint="Encrypted at rest. Sent to the customer on Telegram and shown on their order page."
      >
        <Textarea
          dir="auto"
          rows={7}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Credentials, activation code, or instructions…"
          className="font-mono"
        />
      </Field>
      {delivery.orderItem.product?.activationInstructions && (
        <p className="rounded bg-muted p-2 text-xs text-muted-foreground" dir="auto">
          Product instructions (added to the message automatically): {delivery.orderItem.product.activationInstructions}
        </p>
      )}
      <Input placeholder="Internal note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={!content.trim() || submit.isPending} onClick={() => submit.mutate()}>
          {mode === 'replace' ? 'Replace & resend to customer' : 'Deliver & send to customer'}
        </Button>
        {onCancel && (
          <Button size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
