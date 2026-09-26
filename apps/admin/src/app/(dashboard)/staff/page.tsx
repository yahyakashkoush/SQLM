'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLES } from '@sqlm/shared';
import { Badge, Button, Card, CardContent, Input, Label } from '@sqlm/ui';
import { api, ApiError, type StaffRow } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data-table';

export default function StaffPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', role: 'SUPPORT_AGENT', password: '' });
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['staff'],
    queryFn: () => api.staff(),
  });
  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: () => api.roles() });

  const close = () => {
    setCreating(false);
    setForm({ email: '', name: '', role: 'SUPPORT_AGENT', password: '' });
    setError(null);
    void queryClient.invalidateQueries({ queryKey: ['staff'] });
  };

  const create = useMutation({
    mutationFn: () => api.createStaff(form),
    onSuccess: close,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not create account'),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.updateStaff(id, body),
    onSuccess: close,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Update failed'),
  });

  return (
    <>
      <PageHeader
        title="Staff & Roles"
        description="Roles are named bundles of permissions; every endpoint checks the permission, never the role name."
        action={<Button onClick={() => setCreating(true)}>New staff account</Button>}
      />

      {creating && (
        <Card className="mb-6">
          <CardContent className="space-y-4 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="role">Role</Label>
                <select
                  id="role"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="password">Password (min 12 chars)</Label>
                <Input
                  id="password"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" disabled={create.isPending} onClick={() => create.mutate()}>
                Create
              </Button>
              <Button size="sm" variant="outline" onClick={close}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <DataTable<StaffRow>
        rows={data}
        isLoading={isLoading}
        error={loadError}
        empty="No staff accounts."
        columns={[
          { header: 'Name', cell: (r) => r.name },
          { header: 'Email', cell: (r) => r.email },
          {
            header: 'Role',
            cell: (r) => (
              <select
                value={r.role}
                onChange={(e) => update.mutate({ id: r.id, body: { role: e.target.value } })}
                className="h-8 rounded-md border bg-transparent px-2 text-xs"
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            ),
          },
          {
            header: 'Status',
            cell: (r) => (
              <Badge variant={r.status === 'ACTIVE' ? 'success' : 'destructive'}>{r.status}</Badge>
            ),
          },
          {
            header: '',
            cell: (r) => (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  update.mutate({
                    id: r.id,
                    body: { status: r.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' },
                  })
                }
              >
                {r.status === 'ACTIVE' ? 'Disable' : 'Enable'}
              </Button>
            ),
          },
        ]}
      />

      {roles && (
        <Card className="mt-6">
          <CardContent className="p-4">
            <p className="mb-3 text-sm font-medium">Permission matrix</p>
            <div className="space-y-2 text-xs">
              {roles.map(({ role, permissions }) => (
                <div key={role}>
                  <p className="font-medium">{role}</p>
                  <p className="text-muted-foreground">{permissions.join(', ')}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
