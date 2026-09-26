'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Card, CardContent } from '@sqlm/ui';
import { api, ApiError } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';

export default function NotificationsPage() {
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const broadcast = useMutation({
    mutationFn: () => api.broadcast(message),
    onSuccess: (data) => {
      setResult(`Broadcast sent to ${data.sent} customers.`);
      setMessage('');
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
        title="Notifications"
        description="Send broadcast messages to all active customers via Telegram."
      />

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="space-y-1">
            <label htmlFor="message" className="text-sm font-medium">
              Message
            </label>
            <textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your broadcast message here..."
              rows={4}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {result && <p className="text-sm text-green-600">{result}</p>}

          <Button
            disabled={broadcast.isPending || !message.trim()}
            onClick={() => broadcast.mutate()}
          >
            {broadcast.isPending ? 'Sending...' : 'Send Broadcast'}
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
