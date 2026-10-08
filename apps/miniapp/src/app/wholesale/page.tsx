'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock3, Loader2, Store, XCircle } from 'lucide-react';
import { Button, Card, CardContent, Input, Label, Skeleton } from '@sqlm/ui';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth-store';
import { formatDate, formatMoney } from '@/lib/format';

export default function WholesalePage() {
  const hasSession = useAuthStore((s) => Boolean(s.accessToken));
  const { data: status, isLoading } = useQuery({
    queryKey: ['wholesale'],
    queryFn: api.wholesaleStatus,
    enabled: hasSession,
  });

  return (
    <main className="flex flex-col gap-4 p-4">
      <header>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Store className="h-5 w-5 text-primary" /> عضوية تجار الجملة
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          للتجار والموزعين اللي بيشتروا بكميات: أسعار خاصة على الباقات بعد الموافقة.
        </p>
      </header>

      {!hasSession ? (
        <p className="text-sm text-muted-foreground">افتح التطبيق من جوه تيليجرام علشان تقدّم.</p>
      ) : isLoading || !status ? (
        <Skeleton className="h-40 w-full" />
      ) : status.member ? (
        <MemberCatalog since={status.memberSince} />
      ) : status.application?.status === 'PENDING' ? (
        <Card className="border-amber-300/60 bg-amber-50/60 dark:bg-amber-500/10">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="font-medium">طلبك قيد المراجعة</p>
              <p className="text-muted-foreground">
                قدّمت يوم {formatDate(status.application.createdAt)} — هيوصلك الرد في شات البوت.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {status.application?.status === 'REJECTED' && (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardContent className="flex items-start gap-3 p-4 text-sm">
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                <div>
                  <p className="font-medium">طلبك السابق اترفض</p>
                  {status.application.staffNote && <p className="text-muted-foreground">{status.application.staffNote}</p>}
                  <p className="text-muted-foreground">تقدر تقدّم تاني بعد ما تراجع الشروط.</p>
                </div>
              </CardContent>
            </Card>
          )}
          {status.accepting ? (
            <ApplyForm terms={status.terms} />
          ) : (
            <p className="rounded-lg border p-4 text-sm text-muted-foreground">طلبات العضوية مقفولة حالياً. تابعنا في البوت.</p>
          )}
        </>
      )}
    </main>
  );
}

function ApplyForm({ terms }: { terms: string }) {
  const queryClient = useQueryClient();
  const [businessName, setBusinessName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [monthlyVolume, setMonthlyVolume] = useState('');
  const [notes, setNotes] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = businessName.trim().length >= 2 && contactPhone.replace(/\D/g, '').length >= 8 && accepted;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api.applyWholesale({
        businessName: businessName.trim(),
        contactPhone: contactPhone.trim(),
        monthlyVolume: monthlyVolume.trim() || undefined,
        notes: notes.trim() || undefined,
        acceptTerms: accepted,
      });
      await queryClient.invalidateQueries({ queryKey: ['wholesale'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="space-y-1.5">
          <Label htmlFor="w-name">اسم النشاط أو المتجر</Label>
          <Input id="w-name" value={businessName} maxLength={100} onChange={(e) => setBusinessName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="w-phone">رقم موبايل للتواصل</Label>
          <Input
            id="w-phone"
            type="tel"
            inputMode="tel"
            dir="ltr"
            className="text-end"
            value={contactPhone}
            maxLength={24}
            onChange={(e) => setContactPhone(e.target.value)}
            placeholder="01XXXXXXXXX"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="w-volume">الكمية المتوقعة شهرياً (اختياري)</Label>
          <Input
            id="w-volume"
            value={monthlyVolume}
            maxLength={200}
            onChange={(e) => setMonthlyVolume(e.target.value)}
            placeholder="مثلاً: 50 حساب Canva و 30 ChatGPT"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="w-notes">ملاحظات (اختياري)</Label>
          <textarea
            id="w-notes"
            rows={3}
            maxLength={1000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">شروط العضوية</p>
          <div className="max-h-56 overflow-y-auto whitespace-pre-line rounded-md border bg-muted/40 p-3 text-xs leading-6">
            {terms}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            <span>
              قريت ووافقت على شروط العضوية و
              <Link href="/terms" className="text-primary underline">
                الشروط والأحكام العامة
              </Link>
              .
            </span>
          </label>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button size="lg" disabled={!valid || submitting} onClick={() => void submit()}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          قدّم الطلب
        </Button>
      </CardContent>
    </Card>
  );
}

function MemberCatalog({ since }: { since: string | null }) {
  const { data, isLoading } = useQuery({ queryKey: ['wholesale-catalog'], queryFn: () => fetchCatalog() });

  return (
    <>
      <Card className="border-success/40 bg-success/5">
        <CardContent className="flex items-start gap-3 p-4 text-sm">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
          <div>
            <p className="font-medium">انت عضو جملة{since ? ` من ${formatDate(since)}` : ''}</p>
            <p className="text-muted-foreground">أسعار الجملة بتظهرلك على صفحة كل منتج تحت «اختار الكمية»، وتقدر تدفع من رصيد المحفظة على طول.</p>
            <Link href="/wallet" className="mt-1 inline-block text-xs font-medium text-primary underline">
              المحفظة والرصيد ←
            </Link>
          </div>
        </CardContent>
      </Card>
      <h2 className="text-sm font-semibold">قائمة أسعار الجملة</h2>
      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : !data?.length ? (
        <p className="text-sm text-muted-foreground">مفيش باقات جملة متاحة دلوقتي.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {data.map((p) => (
            <Link key={p.id} href={`/products/${p.slug}`}>
              <Card className="transition hover:border-primary/50">
                <CardContent className="flex items-center gap-3 p-3">
                  {p.images[0] && (
                    // eslint-disable-next-line @next/next/no-img-element -- admin-configured storage host
                    <img src={p.images[0]} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    {p.bundles.map((b) => {
                      const each = Number(b.price) / b.quantity;
                      const saving = Number(p.price) > 0 ? Math.round((1 - each / Number(p.price)) * 100) : 0;
                      return (
                        <p key={b.id} className="flex flex-wrap items-center gap-x-2 text-xs">
                          <span className="font-semibold">{b.quantity} قطعة</span>
                          <span className="tabular-nums">{formatMoney(b.price, p.currency)}</span>
                          <span className="text-muted-foreground">({formatMoney(each.toFixed(2), p.currency)} للقطعة)</span>
                          {saving > 0 && <span className="rounded bg-success/15 px-1.5 text-[10px] font-semibold text-success">وفّر {saving}%</span>}
                        </p>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

type CatalogItem = {
  id: string;
  slug: string;
  name: string;
  images: string[];
  currency: string;
  /** Retail price of one unit, to show what the wholesale price saves. */
  price: string;
  bundles: Array<{ id: string; quantity: number; price: string }>;
};

const fetchCatalog = () => api.wholesaleCatalog() as Promise<CatalogItem[]>;
