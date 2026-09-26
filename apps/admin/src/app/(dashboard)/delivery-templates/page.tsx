'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SETTING_DEFINITIONS } from '@sqlm/shared';
import { Button, Card, CardContent, Input } from '@sqlm/ui';
import { api, ApiError, type DeliveryTemplate } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Field, PlaceholderHint, Textarea } from '@/components/form';
import { useAuthStore } from '@/store/auth-store';

const MESSAGE_PLACEHOLDERS = SETTING_DEFINITIONS.find((d) => d.key === 'delivery.message')?.placeholders;

export default function DeliveryTemplatesPage() {
  const queryClient = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const [editing, setEditing] = useState<DeliveryTemplate | 'new' | null>(null);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['delivery-templates'], queryFn: () => api.deliveryTemplates() });

  const open = (t: DeliveryTemplate | 'new') => {
    setEditing(t);
    setError(null);
    setName(t === 'new' ? '' : t.name);
    setContent(t === 'new' ? '' : t.content);
    setMessage(t === 'new' ? '' : (t.message ?? ''));
  };
  const close = () => {
    setEditing(null);
    void queryClient.invalidateQueries({ queryKey: ['delivery-templates'] });
  };

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), content, message: message.trim() || null };
      return editing && editing !== 'new'
        ? api.updateDeliveryTemplate(editing.id, body)
        : api.createDeliveryTemplate(body);
    },
    onSuccess: close,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Save failed'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteDeliveryTemplate(id),
    onSuccess: close,
  });

  return (
    <>
      <PageHeader
        title="Delivery Templates"
        description="Layouts for what staff send when delivering an order. Attach one to a product and the delivery form is pre-filled with it."
        action={can('products.write') && <Button onClick={() => open('new')}>New template</Button>}
      />

      {editing && (
        <Card className="mb-6">
          <CardContent className="space-y-3 p-4">
            <Field label="Template name *" htmlFor="t-name">
              <Input id="t-name" dir="auto" value={name} onChange={(e) => setName(e.target.value)} placeholder="Netflix profile" />
            </Field>
            <Field
              label="Delivery details layout"
              htmlFor="t-content"
              hint="Staff fill in the blanks, e.g. “Email: ” on one line and “Password: ” on the next."
            >
              <Textarea id="t-content" dir="auto" rows={6} className="font-mono" value={content} onChange={(e) => setContent(e.target.value)} />
            </Field>
            <Field
              label="Custom customer message (optional)"
              htmlFor="t-message"
              hint={
                <>
                  Leave empty to use the store-wide delivery message from Settings.{' '}
                  <PlaceholderHint names={MESSAGE_PLACEHOLDERS} />
                </>
              }
            >
              <Textarea id="t-message" dir="auto" rows={6} value={message} onChange={(e) => setMessage(e.target.value)} />
            </Field>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
                Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              {editing !== 'new' && (
                <Button
                  size="sm"
                  variant="destructive"
                  className="ml-auto"
                  onClick={() => {
                    if (window.confirm('Delete this template? Products using it will have no template.')) {
                      remove.mutate(editing.id);
                    }
                  }}
                >
                  Delete
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data?.length ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">No templates yet.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((t) => (
            <Card key={t.id} className="cursor-pointer hover:border-primary/50" onClick={() => can('products.write') && open(t)}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium" dir="auto">{t.name}</p>
                  <span className="text-xs text-muted-foreground">{t._count?.products ?? 0} products</span>
                </div>
                <pre dir="auto" className="whitespace-pre-wrap rounded bg-muted p-2 text-xs">{t.content || '—'}</pre>
                {t.message && <p className="text-xs text-muted-foreground">Has a custom customer message</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
