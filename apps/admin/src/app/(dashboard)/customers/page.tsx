'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@sqlm/ui';
import { api, type AdminCustomer } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data-table';

export default function CustomersPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['customers', debounced],
    queryFn: () => api.customers(`?pageSize=50${debounced ? `&search=${debounced}` : ''}`),
  });

  return (
    <>
      <PageHeader title="Customers" description="Everyone who has opened the bot or Mini App." />

      <Input
        placeholder="Search by name or Telegram username…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 max-w-sm"
      />

      <DataTable<AdminCustomer>
        rows={data?.items}
        isLoading={isLoading}
        error={error}
        empty="No customers found."
        onRowClick={(row) => router.push(`/customers/${row.id}`)}
        columns={[
          {
            header: 'Name',
            cell: (r) => [r.firstName, r.lastName].filter(Boolean).join(' ') || '—',
          },
          { header: 'Telegram', cell: (r) => (r.telegramUsername ? `@${r.telegramUsername}` : '—') },
          { header: 'Orders', cell: (r) => r._count.orders },
          { header: 'Tickets', cell: (r) => r._count.supportTickets },
          { header: 'Joined', cell: (r) => new Date(r.createdAt).toLocaleDateString() },
        ]}
      />
    </>
  );
}
