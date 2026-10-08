'use client';

import { FileText } from 'lucide-react';
import { Skeleton } from '@sqlm/ui';
import { useStoreInfo } from '@/lib/queries';

export default function TermsPage() {
  const { data: store, isLoading } = useStoreInfo();

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="flex items-center gap-2 text-lg font-semibold">
        <FileText className="h-5 w-5 text-primary" /> الشروط والأحكام
      </h1>
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      ) : (
        <article className="whitespace-pre-line rounded-lg border bg-card p-4 text-sm leading-7">
          {store?.terms ?? '—'}
        </article>
      )}
    </main>
  );
}
