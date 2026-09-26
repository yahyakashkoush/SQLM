'use client';

import { Skeleton } from '@sqlm/ui';

export interface Column<T> {
  header: string;
  cell: (row: T) => React.ReactNode;
  className?: string;
}

/** One table for every list page — keeps loading/empty/error states consistent. */
export function DataTable<T extends { id?: string; key?: string }>({
  columns,
  rows,
  isLoading,
  error,
  empty = 'Nothing here yet.',
  onRowClick,
}: {
  columns: Array<Column<T>>;
  rows: T[] | undefined;
  isLoading?: boolean;
  error?: unknown;
  empty?: string;
  onRowClick?: (row: T) => void;
}) {
  if (error) {
    return (
      <p className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        {error instanceof Error ? error.message : 'Failed to load data'}
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    );
  }

  if (!rows?.length) {
    return <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">{empty}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            {columns.map((col) => (
              <th key={col.header} className={`px-3 py-2 text-left font-medium ${col.className ?? ''}`}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.id ?? row.key ?? i}
              onClick={() => onRowClick?.(row)}
              className={`border-t ${onRowClick ? 'cursor-pointer hover:bg-accent/50' : ''}`}
            >
              {columns.map((col) => (
                <td key={col.header} className={`px-3 py-2 ${col.className ?? ''}`}>
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
