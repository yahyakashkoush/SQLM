'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { TICKET_STATUSES } from '@sqlm/shared';
import { Badge, Button } from '@sqlm/ui';
import { api, type AdminTicket } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data-table';

export default function SupportPage() {
  const router = useRouter();
  const [status, setStatus] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['tickets', status],
    queryFn: () => api.tickets(`?pageSize=50${status ? `&status=${status}` : ''}`),
    refetchInterval: 30_000,
  });

  return (
    <>
      <PageHeader
        title="Support"
        description="Oldest unanswered first — the same threads customers see in Telegram and the Mini App."
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Button size="sm" variant={status ? 'outline' : 'default'} onClick={() => setStatus('')}>
          All
        </Button>
        {TICKET_STATUSES.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={status === s ? 'default' : 'outline'}
            onClick={() => setStatus(s)}
          >
            {s.replace(/_/g, ' ').toLowerCase()}
          </Button>
        ))}
      </div>

      <DataTable<AdminTicket>
        rows={data?.items}
        isLoading={isLoading}
        error={error}
        empty="No tickets match this filter."
        onRowClick={(row) => router.push(`/support/${row.id}`)}
        columns={[
          {
            header: '',
            cell: (r) => (r.staffUnread > 0 ? <Badge>{r.staffUnread}</Badge> : null),
            className: 'w-10',
          },
          { header: 'Ticket', cell: (r) => `#${r.ticketNumber}` },
          { header: 'Subject', cell: (r) => r.subject },
          {
            header: 'Customer',
            cell: (r) =>
              r.customer?.telegramUsername
                ? `@${r.customer.telegramUsername}`
                : (r.customer?.firstName ?? '—'),
          },
          { header: 'Status', cell: (r) => <Badge variant="secondary">{r.status}</Badge> },
          { header: 'Assigned', cell: (r) => r.assignedStaff?.name ?? 'Unassigned' },
          {
            header: 'Last activity',
            cell: (r) => (r.lastMessageAt ? new Date(r.lastMessageAt).toLocaleString() : '—'),
          },
        ]}
      />
    </>
  );
}
