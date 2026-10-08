import { Check, CheckCheck } from 'lucide-react';

/**
 * How buying actually looks: a real-shaped Telegram conversation, not a
 * stock illustration. Purely decorative, so it is hidden from screen
 * readers — the steps section says the same thing in words.
 */
export function ChatMock({ deliveryTime }: { deliveryTime: string }) {
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-[22rem] px-2 sm:px-0">
      <div className="absolute -inset-x-2 -inset-y-6 -z-10 rounded-[2.5rem] sm:-inset-6 bg-[radial-gradient(60%_60%_at_50%_40%,rgb(var(--tg)/0.18),transparent_70%)]" />
      <div className="overflow-hidden rounded-[1.75rem] border border-ink/10 bg-[#E7EEF3] shadow-[0_30px_60px_-30px_rgb(19_21_27/0.45)]">
        <div className="flex items-center gap-3 bg-white px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink font-display text-sm font-extrabold text-paper" dir="ltr">
            s.
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold">subsc</p>
            <p className="text-[11px] text-tg-deep">bot · متصل</p>
          </div>
        </div>

        <div className="space-y-2.5 px-3 py-4 text-[13px] leading-relaxed">
          <Bubble side="out" time="10:41">عايز Canva Pro لمدة سنة</Bubble>
          <Bubble side="in" time="10:41">
            تمام 👌 اختار طريقة الدفع:
            <span className="mt-2 grid grid-cols-2 gap-1.5">
              <Chip>فودافون كاش</Chip>
              <Chip>إنستاباي</Chip>
              <Chip>USDT</Chip>
              <Chip>تحويل بنكي</Chip>
            </span>
          </Bubble>
          <Bubble side="out" time="10:43">
            <span className="flex items-center gap-2">
              <span className="h-10 w-8 rounded bg-ink/10" />
              صورة الإيصال
            </span>
          </Bubble>
          <Bubble side="in" time="10:58">
            ✅ طلبك <span dir="ltr">#1042</span> جاهز!
            <span className="mt-1 block rounded-md bg-ink/[0.04] px-2 py-1.5 font-mono text-[11px]" dir="ltr">
              email: ••••••@•••• <br /> pass: ••••••••
            </span>
            <span className="mt-1 block text-[11px] text-ink-soft">ضمان طول المدة · تسليم {deliveryTime}</span>
          </Bubble>
        </div>
      </div>
    </div>
  );
}

function Bubble({ side, time, children }: { side: 'in' | 'out'; time: string; children: React.ReactNode }) {
  const out = side === 'out';
  return (
    <div className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 shadow-sm ${
          out ? 'rounded-bl-md bg-[#DCF5C6]' : 'rounded-br-md bg-white'
        }`}
      >
        {children}
        <span className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-ink-soft" dir="ltr">
          {time}
          {out ? <CheckCheck className="h-3 w-3 text-tg" /> : <Check className="h-3 w-3 opacity-0" />}
        </span>
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-lg border border-tg/30 bg-tg/[0.06] px-2 py-1 text-center text-[11px] font-medium text-tg-deep">
      {children}
    </span>
  );
}
