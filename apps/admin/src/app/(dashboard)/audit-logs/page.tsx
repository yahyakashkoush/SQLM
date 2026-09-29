'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Input } from '@sqlm/ui';
import { api, type AuditLogRow } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data-table';

export default function AuditLogsPage() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useQuery({
    queryKey: ['audit-logs', action, page],
    queryFn: () => api.auditLogs(`?page=${page}&pageSize=50${action ? `&action=${action}` : ''}`),
  });

  return (
    <>
      <PageHeader
        title="Audit Logs"
        description="Sensitive staff actions — secret reveals, role changes, settings edits."
      />

      <Input
        placeholder="Filter by action (e.g. inventory.reveal_secret)"
        value={action}
        onChange={(e) => {
          setAction(e.target.value);
          setPage(1);
        }}
        className="mb-4 max-w-sm"
      />

      <DataTable<AuditLogRow>
        rows={data?.items}
        isLoading={isLoading}
        error={error}
        empty="No audit entries."
        columns={[
          { header: 'When', cell: (r) => new Date(r.createdAt).toLocaleString() },
          { header: 'Actor', cell: (r) => r.actorStaff?.name ?? 'system' },
          { header: 'Action', cell: (r) => <code className="text-xs">{r.action}</code> },
          { header: 'Entity', cell: (r) => `${r.entityType} ${r.entityId.slice(0, 8)}` },
        ]}
      />

      {data && data.totalPages > 1 && (
        <div className="mt-4 flex items-center gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-muted-foreground">
            Page {data.page} of {data.totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= data.totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </>
  );
}
