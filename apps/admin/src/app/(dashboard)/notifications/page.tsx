'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, Card, CardContent } from '@sqlm/ui';
import { CUSTOMER_SEGMENTS, CUSTOMER_SEGMENT_LABELS, type CustomerSegment } from '@sqlm/shared';
import { api, ApiError } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Checkbox, Field, Textarea } from '@/components/form';
import { ImageUploader } from '@/components/image-uploader';

export default function BroadcastPage() {
  const [message, setMessage] = useState('');
  const [image, setImage] = useState<string[]>([]);
  const [withStoreButton, setWithStoreButton] = useState(true);
  const [segment, setSegment] = useState<CustomerSegment>('ALL');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Audience sizes, so the operator sees who a message reaches before sending.
  const segments = useQuery({ queryKey: ['customer-segments'], queryFn: () => api.customerSegments() });
  const countOf = (s: CustomerSegment) => segments.data?.find((row) => row.segment === s)?.count;
  const audience = countOf(segment);

  const broadcast = useMutation({
    mutationFn: () => api.broadcast({ message: message.trim(), imageUrl: image[0], withStoreButton, segment }),
    onSuccess: (data) => {
      setResult(`Queued for ${data.sent} customers — messages go out over the next few seconds.`);
      setMessage('');
      setImage([]);
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Broadcast failed');
      setResult(null);
    },
  });

  return (
    <>
      <PageHeader
        title="Broadcast"
        description="Send a Telegram message to a group of customers — offers, new products, announcements, win-backs."
      />
      <Card>
        <CardContent className="space-y-4 p-4">
          <Field label="Audience" hint={CUSTOMER_SEGMENT_LABELS[segment].description}>
            <div className="flex flex-wrap gap-2">
              {CUSTOMER_SEGMENTS.map((s) => (
                <Button
                  key={s}
                  type="button"
                  size="sm"
                  variant={segment === s ? 'default' : 'outline'}
                  onClick={() => setSegment(s)}
                >
                  {CUSTOMER_SEGMENT_LABELS[s].label}
                  {countOf(s) !== undefined && <span className="ml-1 opacity-70">({countOf(s)})</span>}
                </Button>
              ))}
            </div>
          </Field>
          <Field label="Message" htmlFor="message" hint={`${message.length} characters`}>
            <Textarea
              id="message"
              dir="auto"
              rows={6}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="🔥 عرض لفترة محدودة…"
            />
          </Field>
          <Field label="Image (optional)">
            <ImageUploader max={1} value={image} onChange={setImage} />
          </Field>
          <Checkbox label="Add an “open the store” button" checked={withStoreButton} onChange={setWithStoreButton} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          {result && <p className="text-sm text-success">{result}</p>}
          <Button
            disabled={broadcast.isPending || !message.trim() || audience === 0}
            onClick={() =>
              window.confirm(
                `Send this message to ${audience ?? 'the selected'} customer${audience === 1 ? '' : 's'} (${CUSTOMER_SEGMENT_LABELS[segment].label})?`,
              ) && broadcast.mutate()
            }
          >
            {broadcast.isPending
              ? 'Sending…'
              : `Send to ${audience ?? '…'} customer${audience === 1 ? '' : 's'}`}
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
