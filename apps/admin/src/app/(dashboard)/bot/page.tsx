'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, Input } from '@sqlm/ui';
import { api, ApiError } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Field, Textarea } from '@/components/form';
import { useAuthStore } from '@/store/auth-store';

export default function BotPage() {
  const queryClient = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: status, isLoading, refetch, isFetching } = useQuery({ queryKey: ['bot'], queryFn: () => api.botStatus() });

  useEffect(() => {
    if (!status) return;
    setName(status.name ?? '');
    setDescription(status.description);
    setShortDescription(status.shortDescription);
  }, [status]);

  const onError = (err: unknown) => setError(err instanceof ApiError ? err.message : 'Request failed');
  const reconnect = useMutation({
    mutationFn: () => api.botReconnect(),
    onSuccess: (s) => {
      queryClient.setQueryData(['bot'], s);
      setMessage('Webhook, commands and menu button registered.');
      setError(null);
    },
    onError,
  });
  const saveProfile = useMutation({
    mutationFn: () => api.botUpdateProfile({ name, description, shortDescription }),
    onSuccess: (s) => {
      queryClient.setQueryData(['bot'], s);
      setMessage('Bot profile updated on Telegram.');
      setError(null);
    },
    onError,
  });

  if (isLoading || !status) return <p className="text-sm text-muted-foreground">Checking the bot…</p>;
  const writable = can('settings.write');

  return (
    <>
      <PageHeader
        title="Telegram Bot"
        description="Connection status and the bot's public profile. Reply texts are under Settings → Bot replies."
        action={
          <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>
            Refresh
          </Button>
        }
      />
      {message && <p className="mb-4 rounded-md border border-success/40 bg-success/10 p-2 text-sm">{message}</p>}
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 p-4 text-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Connection</h2>
              <Badge variant={status.ready && !status.webhook?.lastErrorMessage ? 'success' : 'destructive'}>
                {status.ready ? 'connected' : 'not connected'}
              </Badge>
            </div>
            {status.username && (
              <p>
                Bot:{' '}
                <a href={`https://t.me/${status.username}`} target="_blank" rel="noreferrer" className="text-primary underline">
                  @{status.username}
                </a>
              </p>
            )}
            {status.error && <p className="text-destructive">{status.error}</p>}
            <p className="text-muted-foreground">Mini App URL: {status.miniAppUrl}</p>
            {status.webhook && (
              <div className="space-y-1 rounded bg-muted p-2 text-xs">
                <p>Webhook: {status.webhook.url || <span className="text-destructive">not set</span>}</p>
                <p>Pending updates: {status.webhook.pendingUpdateCount}</p>
                {status.webhook.lastErrorMessage && (
                  <p className="text-destructive">
                    Last error: {status.webhook.lastErrorMessage}
                    {status.webhook.lastErrorDate && ` (${new Date(status.webhook.lastErrorDate).toLocaleString()})`}
                  </p>
                )}
              </div>
            )}
            {!status.configured && (
              <p className="text-xs text-muted-foreground">
                Set TELEGRAM_BOT_TOKEN in the server&apos;s .env file, then redeploy.
              </p>
            )}
            {writable && status.configured && (
              <Button size="sm" disabled={reconnect.isPending} onClick={() => reconnect.mutate()}>
                {reconnect.isPending ? 'Registering…' : 'Re-register webhook & menu'}
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">Bot profile</h2>
            <Field label="Bot name" htmlFor="bot-name">
              <Input id="bot-name" dir="auto" disabled={!status.ready || !writable} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Short description" htmlFor="bot-short" hint="Shown on the bot's profile page (max 120).">
              <Input
                id="bot-short"
                dir="auto"
                maxLength={120}
                disabled={!status.ready || !writable}
                value={shortDescription}
                onChange={(e) => setShortDescription(e.target.value)}
              />
            </Field>
            <Field label="Description" htmlFor="bot-desc" hint="Shown in an empty chat before the user presses Start (max 512).">
              <Textarea
                id="bot-desc"
                dir="auto"
                maxLength={512}
                disabled={!status.ready || !writable}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            {writable && (
              <Button size="sm" disabled={!status.ready || saveProfile.isPending} onClick={() => saveProfile.mutate()}>
                Save profile
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              Welcome message and button replies: <Link href="/settings" className="text-primary underline">Settings</Link>.
              Broadcasts: <Link href="/notifications" className="text-primary underline">Notifications</Link>.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
