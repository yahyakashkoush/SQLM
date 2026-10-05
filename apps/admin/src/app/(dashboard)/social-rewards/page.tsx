'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent } from '@sqlm/ui';
import { CheckCircle, XCircle, ExternalLink } from 'lucide-react';
import { api, type AdminSocialReward } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';

export default function SocialRewardsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['social-rewards-pending'],
    queryFn: () => api.socialRewardsPending(),
    refetchInterval: 30_000,
  });
  const selected = data?.find((r) => r.id === selectedId) ?? data?.[0] ?? null;

  return (
    <>
      <PageHeader
        title="Gift Rewards Review"
        description="Approve or reject social reward claims after verifying the screenshot proof."
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data?.length ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          No pending social reward claims.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <div className="space-y-2">
            {data.map((reward) => (
              <Card
                key={reward.id}
                onClick={() => setSelectedId(reward.id)}
                className={`cursor-pointer ${selected?.id === reward.id ? 'border-primary' : 'hover:border-primary/40'}`}
              >
                <CardContent className="flex items-center justify-between p-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{reward.product.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {reward.customer.firstName ?? 'Customer'}
                      {reward.customer.telegramUsername && ` (@${reward.customer.telegramUsername})`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {reward.claimType === 'FACEBOOK_COMMENT' ? '💬 Comment' : '⭐ Rating'} ·{' '}
                      {new Date(reward.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge variant="warning">pending</Badge>
                </CardContent>
              </Card>
            ))}
          </div>

          {selected && (
            <RewardDetail
              key={selected.id}
              reward={selected}
              onDone={() => setSelectedId(null)}
            />
          )}
        </div>
      )}
    </>
  );
}

function RewardDetail({ reward, onDone }: { reward: AdminSocialReward; onDone: () => void }) {
  const qc = useQueryClient();
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['social-rewards-pending'] });
    onDone();
  };

  const approveMut = useMutation({
    mutationFn: () => api.approveSocialReward(reward.id),
    onSuccess: invalidate,
  });

  const rejectMut = useMutation({
    mutationFn: () => api.rejectSocialReward(reward.id, rejectionReason),
    onSuccess: invalidate,
  });

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        {/* Product + customer header */}
        <div className="flex items-start gap-3">
          {reward.product.images[0] && (
            <img
              src={reward.product.images[0]}
              alt={reward.product.name}
              className="h-14 w-14 shrink-0 rounded-lg object-cover"
            />
          )}
          <div>
            <p className="font-semibold">{reward.product.name}</p>
            <p className="text-sm text-muted-foreground">
              {reward.customer.firstName ?? 'Customer'}
              {reward.customer.telegramUsername && ` · @${reward.customer.telegramUsername}`}
            </p>
            <p className="text-xs text-muted-foreground">
              {reward.claimType === 'FACEBOOK_COMMENT' ? '💬 Facebook Comment' : '⭐ Facebook Rating'} ·{' '}
              {new Date(reward.createdAt).toLocaleString()}
            </p>
          </div>
        </div>

        {/* URLs */}
        {(reward.facebookPostUrl || reward.facebookProfileUrl) && (
          <div className="space-y-1 text-sm">
            {reward.facebookPostUrl && (
              <a
                href={reward.facebookPostUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-primary underline truncate"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                Post URL
              </a>
            )}
            {reward.facebookProfileUrl && (
              <a
                href={reward.facebookProfileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-primary underline truncate"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                Profile URL
              </a>
            )}
          </div>
        )}

        {/* Screenshot proofs */}
        <div>
          <p className="mb-2 text-sm font-medium">Proof Screenshots ({reward.proofScreenshots.length})</p>
          <div className="flex flex-wrap gap-2">
            {reward.proofScreenshots.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                <img
                  src={url}
                  alt={`proof ${i + 1}`}
                  className="h-24 w-24 rounded-lg object-cover border hover:opacity-80 transition-opacity"
                />
              </a>
            ))}
          </div>
        </div>

        {/* Actions */}
        {!showRejectForm ? (
          <div className="flex gap-2 pt-2">
            <Button
              className="flex-1 bg-green-600 hover:bg-green-700"
              disabled={approveMut.isPending}
              onClick={() => approveMut.mutate()}
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              {approveMut.isPending ? 'Approving…' : 'Approve'}
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => setShowRejectForm(true)}
            >
              <XCircle className="mr-2 h-4 w-4" />
              Reject
            </Button>
          </div>
        ) : (
          <div className="space-y-2 pt-2">
            <textarea
              placeholder="Rejection reason (sent to customer on Telegram)"
              value={rejectionReason}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRejectionReason(e.target.value)}
              rows={3}
              className="w-full rounded-md border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex gap-2">
              <Button
                variant="destructive"
                className="flex-1"
                disabled={!rejectionReason.trim() || rejectMut.isPending}
                onClick={() => rejectMut.mutate()}
              >
                {rejectMut.isPending ? 'Rejecting…' : 'Confirm Reject'}
              </Button>
              <Button variant="outline" onClick={() => setShowRejectForm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {(approveMut.isError || rejectMut.isError) && (
          <p className="text-sm text-destructive">
            {String((approveMut.error ?? rejectMut.error) instanceof Error
              ? (approveMut.error ?? rejectMut.error as Error).message
              : 'Request failed')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
