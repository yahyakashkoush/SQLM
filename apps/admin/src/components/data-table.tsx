'use client';

import { Skeleton } from '@sqlm/ui';

export interface Column<T> {
  header: string;
  cell: (row: T) => React.ReactNode;
  className?: string;
  /** Phone layout: leave this column out of the card (it is shown elsewhere or not needed). */
  hideOnMobile?: boolean;
}

/**
 * One table for every list page — keeps loading/empty/error states
 * consistent. Below `md` each row becomes a card: the first column is its
 * title, the rest are label/value lines, and a column with an empty
 * header (row actions) sits at the bottom.
 */
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

  // A leading header-less column (a thumbnail, a checkbox) joins the first
  // named column to form the card's title row.
  const firstNamed = columns.findIndex((c) => c.header.trim() !== '');
  const titleColumns = columns.slice(0, Math.max(firstNamed, 0) + 1);
  const rest = columns.slice(titleColumns.length);
  const detailColumns = rest.filter((c) => !c.hideOnMobile && c.header.trim() !== '');
  const actionColumns = rest.filter((c) => !c.hideOnMobile && c.header.trim() === '');

  return (
    <>
      <div className="space-y-2 md:hidden">
        {rows.map((row, i) => (
          <div
            key={row.id ?? row.key ?? i}
            onClick={() => onRowClick?.(row)}
            className={`rounded-lg border bg-card p-3 text-sm ${onRowClick ? 'cursor-pointer active:bg-accent/60' : ''}`}
          >
            <div className="mb-2 flex min-w-0 items-center gap-3 font-medium [&_*]:break-words">
              {titleColumns.map((col, j) => (
                <div key={j} className={j === titleColumns.length - 1 ? 'min-w-0 flex-1' : 'shrink-0'}>
                  {col.cell(row)}
                </div>
              ))}
            </div>
            {detailColumns.length > 0 && (
              <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5">
                {detailColumns.map((col) => (
                  <div key={col.header} className="contents">
                    <dt className="text-xs text-muted-foreground">{col.header}</dt>
                    <dd className="flex min-w-0 justify-end break-words text-right">{col.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {actionColumns.length > 0 && (
              <div className="mt-3 flex flex-wrap justify-end gap-2 border-t pt-3" onClick={(e) => e.stopPropagation()}>
                {actionColumns.map((col, j) => (
                  <div key={j}>{col.cell(row)}</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              {columns.map((col, j) => (
                <th key={`${col.header}-${j}`} className={`px-3 py-2 text-left font-medium ${col.className ?? ''}`}>
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
                {columns.map((col, j) => (
                  <td key={`${col.header}-${j}`} className={`px-3 py-2 ${col.className ?? ''}`}>
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
