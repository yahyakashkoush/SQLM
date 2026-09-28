'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, CheckCircle2, ExternalLink } from 'lucide-react';
import { Badge, Button, Card, CardContent } from '@sqlm/ui';
import { api, ApiError } from '@/lib/api';
import { Checkbox } from '@/components/form';

/**
 * Links the signed-in staff member's Telegram account, so new orders and
 * payment proofs reach their phone — with approve/reject buttons on the
 * proof itself.
 *
 * The link is a one-time t.me deep link: opening it in Telegram is what
 * proves the account is theirs, so nobody types an ID anywhere. `compact`
 * is the dashboard nudge, shown only until the account is linked.
 */
export function TelegramLinkCard({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingLink, setPendingLink] = useState<string | null>(null);

  const { data } = useQuery({ queryKey: ['my-telegram'], queryFn: () => api.myTelegram() });
  const onError = (err: unknown) => setError(err instanceof ApiError ? err.message : 'Request failed');
  const update = (next: { linked: boolean; notify: boolean }) => queryClient.setQueryData(['my-telegram'], next);

  const createLink = useMutation({
    mutationFn: () => api.createTelegramLink(),
    onSuccess: ({ url }) => {
      setError(null);
      setPendingLink(url);
      // Opens Telegram on a phone, or the web client on a desktop; the
      // link stays on screen in case the pop-up was blocked.
      window.open(url, '_blank', 'noopener');
    },
    onError,
  });
  const setNotify = useMutation({ mutationFn: (notify: boolean) => api.setTelegramNotify(notify), onSuccess: update, onError });
  const unlink = useMutation({
    mutationFn: () => api.unlinkTelegram(),
    onSuccess: (next) => {
      update(next);
      setPendingLink(null);
    },
    onError,
  });
  const test = useMutation({
    mutationFn: () => api.testTelegram(),
    onSuccess: () => setNotice('Test message sent — check Telegram.'),
    onError,
  });

  if (!data) return null;
  if (compact && data.linked) return null;

  return (
    <Card>
      <CardContent className="space-y-3 p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 font-medium">
            <BellRing className="h-4 w-4" /> Order alerts on your phone
          </p>
          {data.linked ? (
            <Badge variant="success">
              <CheckCircle2 className="mr-1 h-3 w-3" /> Linked
            </Badge>
          ) : (
            <Badge variant="outline">Not linked</Badge>
          )}
        </div>

        {!data.linked ? (
          <>
            <p className="text-muted-foreground">
              Get every new order, payment screenshot, automatic crypto payment and support message in Telegram — and
              approve or reject a payment with one tap.
            </p>
            <Button size="sm" disabled={createLink.isPending} onClick={() => createLink.mutate()}>
              Link my Telegram
            </Button>
            {pendingLink && (
              <div className="space-y-2 rounded-md border p-3">
                <p>
                  Telegram should have opened — press <b>Start</b> in the bot chat. If it didn&apos;t open,{' '}
                  <a href={pendingLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
                    open the link <ExternalLink className="h-3 w-3" />
                  </a>
                  . It works once and expires in 10 minutes.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void queryClient.invalidateQueries({ queryKey: ['my-telegram'] })}
                >
                  I pressed Start
                </Button>
              </div>
            )}
          </>
        ) : (
          !compact && (
            <div className="space-y-3">
              <Checkbox
                label="Send me alerts"
                hint="New orders, payment proofs (with approve/reject), crypto payments, support messages, low stock. What you see follows your role."
                checked={data.notify}
                onChange={(v) => setNotify.mutate(v)}
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
                  Send a test message
                </Button>
                <Button size="sm" variant="ghost" disabled={unlink.isPending} onClick={() => unlink.mutate()}>
                  Unlink
                </Button>
              </div>
            </div>
          )
        )}

        {notice && <p className="text-xs text-success">{notice}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
