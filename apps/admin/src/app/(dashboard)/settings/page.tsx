'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardContent } from '@sqlm/ui';
import { api, ApiError } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['settings'], queryFn: () => api.settings() });

  const save = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => {
      // Settings are free-form JSON; accept a raw value if it isn't valid JSON.
      let parsed: unknown = value;
      try {
        parsed = JSON.parse(value);
      } catch {
        /* keep the string as-is */
      }
      return api.updateSetting(key, parsed);
    },
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Save failed'),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <>
      <PageHeader
        title="Settings"
        description="Platform-wide values the code reads at runtime instead of hardcoding."
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {!data?.length ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          No settings defined yet.
        </p>
      ) : (
        <div className="space-y-3">
          {data.map((setting) => {
            const current = drafts[setting.key] ?? JSON.stringify(setting.value);
            return (
              <Card key={setting.key}>
                <CardContent className="flex items-center gap-3 p-3">
                  <code className="w-64 shrink-0 text-xs">{setting.key}</code>
                  <input
                    value={current}
                    onChange={(e) => setDrafts({ ...drafts, [setting.key]: e.target.value })}
                    className="h-9 flex-1 rounded-md border bg-transparent px-2 text-sm"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={save.isPending}
                    onClick={() => save.mutate({ key: setting.key, value: current })}
                  >
                    Save
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
