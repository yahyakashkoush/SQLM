'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, LifeBuoy, Loader2, Plus, Send } from 'lucide-react';
import { Badge, Button, Card, CardContent, Input, Skeleton } from '@sqlm/ui';
import { useOrders, useStoreInfo, useTicket, useTickets } from '@/lib/queries';
import { useAuthStore } from '@/store/auth-store';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';

const STATUS_AR: Record<string, string> = {
  OPEN: 'مفتوحة',
  IN_PROGRESS: 'قيد المعالجة',
  WAITING_CUSTOMER: 'بانتظار ردك',
  WAITING_ADMIN: 'بانتظار الدعم',
  RESOLVED: 'تم الحل',
  CLOSED: 'مغلقة',
};

const CATEGORY_AR: Record<string, string> = {
  ORDER_ISSUE: 'مشكلة في طلب',
  PAYMENT_ISSUE: 'مشكلة في الدفع',
  DELIVERY_ISSUE: 'مشكلة في التسليم',
  PRODUCT_QUESTION: 'سؤال عن منتج',
  ACCOUNT_ISSUE: 'مشكلة في الحساب',
  OTHER: 'أخرى',
};

const textareaClass = 'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm';

function SupportCenter() {
  const params = useSearchParams();
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const ticketId = params.get('ticket');
  const orderId = params.get('order');
  const [creating, setCreating] = useState(Boolean(orderId));
  const tickets = useTickets();
  const store = useStoreInfo();

  if (!accessToken) {
    return (
      <main className="flex flex-col items-center gap-3 p-8 text-center">
        <LifeBuoy className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">افتح التطبيق من جوه تيليجرام علشان تتواصل مع الدعم.</p>
      </main>
    );
  }

  if (ticketId) return <TicketThreadView id={ticketId} onBack={() => router.push('/support')} />;
  if (creating)
    return (
      <NewTicketForm
        orderId={orderId}
        onCancel={() => {
          setCreating(false);
          router.replace('/support');
        }}
        onCreated={(id) => router.push(`/support?ticket=${id}`)}
      />
    );

  return (
    <main className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">الدعم الفني</h1>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> تذكرة جديدة
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        تقدر كمان تكتب رسالتك مباشرة في شات البوت.
        {store.data?.supportContact && (
          <>
            {' '}للتواصل: <span dir="ltr">{store.data.supportContact}</span>
          </>
        )}
      </p>

      {tickets.isLoading ? (
        <Skeleton className="h-20 w-full rounded-lg" />
      ) : tickets.data?.items.length ? (
        <div className="flex flex-col gap-3">
          {tickets.data.items.map((t) => (
            <Card key={t.id} className="cursor-pointer" onClick={() => router.push(`/support?ticket=${t.id}`)}>
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{t.subject}</p>
                  <p className="text-xs text-muted-foreground">
                    #{t.ticketNumber} · {CATEGORY_AR[t.category] ?? t.category} · {formatDate(t.lastMessageAt ?? t.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {t.customerUnread > 0 && <Badge variant="destructive">{t.customerUnread}</Badge>}
                  <Badge variant={['RESOLVED', 'CLOSED'].includes(t.status) ? 'secondary' : 'warning'}>
                    {STATUS_AR[t.status] ?? t.status}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <LifeBuoy className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">مفيش تذاكر دعم. لو عندك أي مشكلة افتح تذكرة جديدة.</p>
        </div>
      )}
    </main>
  );
}

function NewTicketForm({
  orderId,
  onCancel,
  onCreated,
}: {
  orderId: string | null;
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const orders = useOrders();
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState(orderId ? 'ORDER_ISSUE' : 'OTHER');
  const [order, setOrder] = useState(orderId ?? '');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSending(true);
    setError(null);
    try {
      const ticket = await api.createTicket({
        subject: subject.trim(),
        message: message.trim(),
        category,
        orderId: order || undefined,
      });
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      onCreated(ticket.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذر إرسال التذكرة');
      setSending(false);
    }
  };

  return (
    <main className="flex flex-col gap-4 p-4">
      <button type="button" onClick={onCancel} className="flex w-fit items-center gap-1 text-sm text-muted-foreground">
        <ArrowRight className="h-4 w-4" /> رجوع
      </button>
      <h1 className="text-lg font-semibold">تذكرة دعم جديدة</h1>

      <label className="space-y-1 text-sm">
        <span>نوع المشكلة</span>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${textareaClass} h-10`}>
          {Object.entries(CATEGORY_AR).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {orders.data?.items.length ? (
        <label className="space-y-1 text-sm">
          <span>الطلب (اختياري)</span>
          <select value={order} onChange={(e) => setOrder(e.target.value)} className={`${textareaClass} h-10`}>
            <option value="">— بدون —</option>
            {orders.data.items.map((o) => (
              <option key={o.id} value={o.id}>
                طلب #{o.sequenceNumber}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="space-y-1 text-sm">
        <span>العنوان</span>
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="مثال: الحساب مش شغال" />
      </label>
      <label className="space-y-1 text-sm">
        <span>اشرح المشكلة</span>
        <textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} className={textareaClass} />
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button disabled={sending || subject.trim().length < 3 || !message.trim()} onClick={() => void submit()}>
        {sending && <Loader2 className="h-4 w-4 animate-spin" />} إرسال
      </Button>
    </main>
  );
}

function TicketThreadView({ id, onBack }: { id: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const { data: ticket, isLoading, refetch } = useTicket(id);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
    void queryClient.invalidateQueries({ queryKey: ['tickets'] });
  }, [ticket?.messages.length, queryClient]);

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      await api.replyTicket(id, message.trim());
      setMessage('');
      await refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذر الإرسال');
    } finally {
      setSending(false);
    }
  };

  if (isLoading || !ticket) return <main className="p-4 text-sm text-muted-foreground">جاري التحميل…</main>;

  return (
    <main className="flex min-h-[calc(100vh-4rem)] flex-col gap-3 p-4 pb-36">
      <button type="button" onClick={onBack} className="flex w-fit items-center gap-1 text-sm text-muted-foreground">
        <ArrowRight className="h-4 w-4" /> كل التذاكر
      </button>
      <div>
        <h1 className="text-base font-semibold">{ticket.subject}</h1>
        <p className="text-xs text-muted-foreground">
          #{ticket.ticketNumber} · {STATUS_AR[ticket.status] ?? ticket.status}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {ticket.messages.map((m) => {
          const mine = m.authorType === 'CUSTOMER';
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${mine ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                {!mine && <p className="mb-0.5 text-[11px] font-medium opacity-70">الدعم الفني</p>}
                <p className="whitespace-pre-line break-words">{m.message}</p>
                <p className="mt-1 text-[10px] opacity-60">{new Date(m.createdAt).toLocaleString('ar-EG')}</p>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="fixed inset-x-0 bottom-16 z-40 border-t bg-background p-3">
        {error && <p className="mb-1 text-xs text-destructive">{error}</p>}
        <div className="flex items-end gap-2">
          <textarea
            rows={1}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="اكتب رسالتك…"
            className={`${textareaClass} max-h-32 flex-1 resize-none`}
          />
          <Button size="icon" aria-label="إرسال" disabled={sending || !message.trim()} onClick={() => void send()}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 -scale-x-100" />}
          </Button>
        </div>
      </div>
    </main>
  );
}

export default function SupportPage() {
  return (
    <Suspense fallback={<main className="p-4 text-sm text-muted-foreground">جاري التحميل…</main>}>
      <SupportCenter />
    </Suspense>
  );
}
