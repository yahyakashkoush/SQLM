'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Card, CardContent } from '@sqlm/ui';
import { api, ApiError } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Checkbox, Field, Textarea } from '@/components/form';
import { ImageUploader } from '@/components/image-uploader';

export default function BroadcastPage() {
  const [message, setMessage] = useState('');
  const [image, setImage] = useState<string[]>([]);
  const [withStoreButton, setWithStoreButton] = useState(true);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const broadcast = useMutation({
    mutationFn: () => api.broadcast({ message: message.trim(), imageUrl: image[0], withStoreButton }),
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
      <PageHeader title="Broadcast" description="Send a Telegram message to every active customer — offers, new products, announcements." />
      <Card>
        <CardContent className="space-y-4 p-4">
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
            disabled={broadcast.isPending || !message.trim()}
            onClick={() => window.confirm('Send this message to all customers?') && broadcast.mutate()}
          >
            {broadcast.isPending ? 'Sending…' : 'Send broadcast'}
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
