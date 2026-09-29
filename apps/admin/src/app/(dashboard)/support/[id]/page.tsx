'use client';

import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TICKET_STATUSES } from '@sqlm/shared';
import { Badge, Button, Card, CardContent } from '@sqlm/ui';
import { api, ApiError } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { useAuthStore } from '@/store/auth-store';

export default function TicketThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.staff);
  const [message, setMessage] = useState('');
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api.ticket(id),
    refetchInterval: 20_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['ticket', id] });
    void queryClient.invalidateQueries({ queryKey: ['tickets'] });
  };

  const reply = useMutation({
    mutationFn: () => api.replyTicket(id, message, internal),
    onSuccess: () => {
      setMessage('');
      setError(null);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Reply failed'),
  });

  const assign = useMutation({
    mutationFn: (staffId: string | null) => api.assignTicket(id, staffId),
    onSuccess: invalidate,
  });

  const setStatus = useMutation({
    mutationFn: (status: string) => api.setTicketStatus(id, status),
    onSuccess: invalidate,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading thread…</p>;
  if (!ticket) return <p className="text-sm text-muted-foreground">Ticket not found.</p>;

  return (
    <>
      <PageHeader
        title={`#${ticket.ticketNumber} · ${ticket.subject}`}
        description={`${ticket.category.replace(/_/g, ' ').toLowerCase()}${
          ticket.order ? ` · linked to order #${ticket.order.sequenceNumber}` : ''
        }`}
        action={<Badge variant="secondary">{ticket.status}</Badge>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant={ticket.assignedStaffId === me?.id ? 'default' : 'outline'}
          onClick={() => assign.mutate(ticket.assignedStaffId === me?.id ? null : (me?.id ?? null))}
        >
          {ticket.assignedStaffId === me?.id ? 'Assigned to me' : 'Assign to me'}
        </Button>
        {TICKET_STATUSES.filter((s) => s !== ticket.status).map((s) => (
          <Button key={s} size="sm" variant="outline" onClick={() => setStatus.mutate(s)}>
            {s.replace(/_/g, ' ').toLowerCase()}
          </Button>
        ))}
      </div>

      <Card className="mb-4">
        <CardContent className="space-y-3 p-4">
          {ticket.messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-md p-3 text-sm ${
                m.internal
                  ? 'border border-dashed bg-muted/40'
                  : m.authorType === 'CUSTOMER'
                    ? 'bg-muted'
                    : 'bg-primary/10'
              }`}
            >
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span>{m.authorType}</span>
                {m.internal && <Badge variant="outline">internal</Badge>}
                <span>{new Date(m.createdAt).toLocaleString()}</span>
              </div>
              <p className="whitespace-pre-wrap">{m.message}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="Reply to the customer…"
            className="w-full rounded-md border bg-transparent p-2 text-sm"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={internal}
              onChange={(e) => setInternal(e.target.checked)}
            />
            Internal note (other staff only — the customer never sees this)
          </label>
          <Button size="sm" disabled={!message || reply.isPending} onClick={() => reply.mutate()}>
            {internal ? 'Add internal note' : 'Send reply'}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </>
  );
}
