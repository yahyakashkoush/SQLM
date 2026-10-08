import Link from 'next/link';
import { Coins, MessageCircleQuestion, Send, ShieldCheck, Timer, Wallet } from 'lucide-react';
import { getSite } from '@/lib/api';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { HeroRobot } from '@/components/hero-robot';
import { ProductCatalog } from '@/components/product-catalog';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const site = await getSite();

  const steps = [
    { title: 'افتح البوت', body: 'اضغط «ابدأ» في بوت المتجر على تيليجرام — من غير تسجيل ولا باسوورد.' },
    { title: 'اختار المنتج', body: 'تصفّح المنتجات والباقات جوه البوت، والأسعار والعروض الحالية بتظهرلك هناك.' },
    { title: 'ادفع بطريقتك', body: 'حوّل المبلغ بالظبط وابعت صورة الإيصال، أو ادفع USDT ويتأكد تلقائي.' },
    { title: 'استلم في الشات', body: `بيانات المنتج بتوصلك في نفس المحادثة ${site.deliveryTime} بعد تأكيد الدفع.` },
  ];

  const faqs = [
    {
      q: 'المنتجات أصلية؟',
      a: 'أيوه. كل اشتراك بيشتغل على المنصة الأصلية نفسها، ونوعه (حساب مشترك، حساب خاص، أو كود تفعيل) مكتوب بوضوح قبل ما تشتري.',
    },
    {
      q: 'إمتى بستلم؟',
      a: `${site.deliveryTime} بعد ما الدفع يتأكد. الدفع بالـ USDT بيتأكد تلقائي أول ما التحويل يوصل.`,
    },
    {
      q: 'لو الاشتراك وقف؟',
      a: 'كل منتج عليه ضمان طول مدته. ابعت للدعم في نفس الشات وهنصلّحه أو نبدّله.',
    },
    {
      q: 'ليه الأسعار مش على الموقع؟',
      a: 'الأسعار والعروض بتتغير بسرعة، فبنعرضها في مكان واحد بس: جوه البوت، علشان اللي تشوفه هو اللي تدفعه.',
    },
    {
      q: 'بيعوا جملة؟',
      a: 'أيوه. قدّم على عضوية تجار الجملة من حسابك في البوت، وبعد الموافقة هتظهرلك أسعار الباقات بالكميات.',
    },
  ];

  return (
    <>
      <SiteHeader botUrl={site.botUrl} />

      <main>
        {/* Hero */}
        <section className="site-container grid items-center gap-12 pb-20 pt-10 sm:pt-16 lg:grid-cols-[1.15fr,1fr] lg:gap-16 lg:pb-28">
          <div className="space-y-7">
            <p className="eyebrow">متجر اشتراكات رقمية · على تيليجرام</p>
            <h1 className="text-[2.15rem] font-extrabold leading-[1.25] sm:text-5xl sm:leading-[1.2] lg:text-[3.4rem]">
              {site.tagline}
            </h1>
            <p className="max-w-xl text-base leading-8 text-ink-soft sm:text-lg">
              ChatGPT و Canva و Adobe و CapCut و VPN وأكتر. اختار من البوت، ادفع بفودافون كاش أو إنستاباي أو USDT،
              واستلم في نفس الشات.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <a href={site.botUrl} className="btn-primary py-3.5 text-base" rel="noopener">
                <Send className="h-4 w-4 -scale-x-100" /> ابدأ على تيليجرام
              </a>
              <Link href="#products" className="btn-ghost py-3.5 text-base">
                شوف المنتجات
              </Link>
            </div>
            <ul className="flex flex-wrap gap-x-6 gap-y-3 pt-2 text-sm text-ink-soft">
              <li className="flex items-center gap-2">
                <Timer className="h-4 w-4 text-tg-deep" /> تسليم {site.deliveryTime}
              </li>
              <li className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-tg-deep" /> ضمان طول المدة
              </li>
              <li className="flex items-center gap-2">
                <MessageCircleQuestion className="h-4 w-4 text-tg-deep" /> دعم حقيقي بيرد بنفسه
              </li>
            </ul>
          </div>
          <HeroRobot />
        </section>

        {/* Products */}
        <section id="products" className="scroll-mt-20 border-t border-line bg-paper-deep/50 py-20">
          <div className="site-container">
            <div className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-3">
                <p className="eyebrow">المتاح دلوقتي</p>
                <h2 className="text-3xl font-bold sm:text-4xl">المنتجات</h2>
              </div>
              <p className="max-w-sm text-sm leading-7 text-ink-soft">
                الأسعار والعروض والباقات بتظهر جوه البوت. اضغط على أي منتج وهيفتحلك عليه مباشرة.
              </p>
            </div>
            <ProductCatalog products={site.products} categories={site.categories} botUrl={site.botUrl} />
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-16 bg-ink py-20 text-paper">
          <div className="site-container">
            <div className="mb-12 space-y-3">
              <p className="text-xs font-semibold tracking-[0.08em] text-tg">طريقة الشراء</p>
              <h2 className="text-3xl font-bold sm:text-4xl">أربع خطوات، وكلها في شات واحد.</h2>
            </div>
            <ol className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((step, i) => (
                <li key={step.title} className="space-y-3 border-t border-paper/15 pt-5">
                  <span className="font-display text-4xl font-extrabold text-paper/25 tabular-nums" dir="ltr">
                    0{i + 1}
                  </span>
                  <h3 className="text-lg font-bold">{step.title}</h3>
                  <p className="text-sm leading-7 text-paper/70">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Payments */}
        <section id="payments" className="site-container scroll-mt-16 py-20">
          <div className="grid gap-10 lg:grid-cols-[1fr,1.4fr] lg:gap-16">
            <div className="space-y-4">
              <p className="eyebrow">الدفع</p>
              <h2 className="text-3xl font-bold sm:text-4xl">ادفع بالطريقة اللي تناسبك.</h2>
              <p className="text-sm leading-7 text-ink-soft">
                كل تحويل بيتراجع على كشف الحساب قبل التسليم. الإيصالات المزيفة أو المكررة بتلغي الطلب وبتوقف الحساب.
              </p>
            </div>
            {site.paymentMethods.length > 0 ? (
              <ul className="grid gap-3 sm:grid-cols-2">
                {site.paymentMethods.map((m) => (
                  <li key={m.id} className="flex items-start gap-4 rounded-2xl border bg-paper p-5">
                    {m.logoUrl ? (
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-white">
                        {/* eslint-disable-next-line @next/next/no-img-element -- uploaded to the store's own storage host */}
                        <img src={m.logoUrl} alt={m.name} loading="lazy" className="h-full w-full object-contain p-1.5" />
                      </span>
                    ) : (
                      <span
                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
                          m.kind === 'crypto' ? 'bg-saffron/15 text-saffron' : 'bg-tg/10 text-tg-deep'
                        }`}
                      >
                        {m.kind === 'crypto' ? <Coins className="h-5 w-5" /> : <Wallet className="h-5 w-5" />}
                      </span>
                    )}
                    <div className="min-w-0 space-y-1">
                      <p className="font-semibold" dir="auto">
                        {m.name}
                      </p>
                      <p className="text-xs leading-6 text-ink-soft" dir="auto">
                        {m.description ??
                          (m.kind === 'crypto' ? `${m.currency} — بيتأكد تلقائي أول ما يوصل` : `بالـ ${m.currency} — ارفع صورة الإيصال`)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-2xl border border-dashed p-8 text-sm text-ink-soft">
                طرق الدفع المتاحة بتظهر جوه البوت وقت الطلب.
              </p>
            )}
          </div>
        </section>

        {/* About + FAQ */}
        <section id="about" className="scroll-mt-16 border-t border-line py-20">
          <div className="site-container grid gap-14 lg:grid-cols-2 lg:gap-20">
            <div className="space-y-4">
              <p className="eyebrow">عن المتجر</p>
              <h2 className="text-3xl font-bold sm:text-4xl">{site.name}</h2>
              <p className="whitespace-pre-line text-base leading-8 text-ink-soft">{site.about}</p>
            </div>
            <div>
              <h2 className="mb-4 text-xl font-bold">أسئلة بتتكرر</h2>
              <div className="divide-y divide-line border-y border-line">
                {faqs.map((f) => (
                  <details key={f.q} className="group py-4">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                      {f.q}
                      <span className="text-xl leading-none text-ink-soft transition group-open:rotate-45">+</span>
                    </summary>
                    <p className="pt-3 text-sm leading-7 text-ink-soft">{f.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Closing call to action */}
        <section className="site-container pb-20">
          <div className="flex flex-col items-start gap-6 rounded-3xl bg-tg/[0.08] p-8 sm:flex-row sm:items-center sm:justify-between sm:p-12">
            <div className="space-y-2">
              <h2 className="text-2xl font-bold sm:text-3xl">جاهز تبدأ؟</h2>
              <p className="text-sm text-ink-soft">البوت شغال 24 ساعة، والدعم بيرد عليك في نفس الشات.</p>
            </div>
            <a href={site.botUrl} className="btn-primary w-full py-3.5 text-base sm:w-auto" rel="noopener">
              <Send className="h-4 w-4 -scale-x-100" /> افتح البوت
            </a>
          </div>
        </section>
      </main>

      <SiteFooter botUrl={site.botUrl} supportContact={site.supportContact} />
    </>
  );
}
