'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Menu, Send, X } from 'lucide-react';

const LINKS = [
  { href: '/#products', label: 'المنتجات' },
  { href: '/#how', label: 'طريقة الشراء' },
  { href: '/#payments', label: 'الدفع' },
  { href: '/#about', label: 'عن المتجر' },
  { href: '/terms', label: 'الشروط والأحكام' },
];

export function SiteHeader({ botUrl }: { botUrl: string }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    // Rotating a phone into the desktop layout leaves no menu to close.
    const wide = window.matchMedia('(min-width: 768px)');
    const onWide = () => wide.matches && setOpen(false);
    window.addEventListener('keydown', onKey);
    wide.addEventListener('change', onWide);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
      wide.removeEventListener('change', onWide);
    };
  }, [open]);

  return (
    <>
      <header
        className={`sticky top-0 z-40 transition-[background,border-color] ${
          open
            ? 'border-b border-line bg-paper'
            : scrolled
              ? 'border-b border-line bg-paper/90 backdrop-blur'
              : 'border-b border-transparent'
        }`}
      >
        <div className="site-container flex h-16 items-center justify-between gap-4">
          <Link
            href="/"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2"
            aria-label="subsc — الرئيسية"
          >
            <Logo />
          </Link>

          <nav
            className="hidden items-center gap-7 text-sm text-ink-soft md:flex"
            aria-label="الأقسام"
          >
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="transition hover:text-ink">
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <a
              href={botUrl}
              className="btn-primary hidden !px-5 !py-2.5 sm:inline-flex"
              rel="noopener"
            >
              <Send className="h-4 w-4 -scale-x-100" /> افتح البوت
            </a>
            <button
              type="button"
              className="rounded-full p-2.5 md:hidden"
              aria-label={open ? 'إغلاق القائمة' : 'فتح القائمة'}
              aria-expanded={open}
              aria-controls="mobile-menu"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </header>

      {/* Lives outside <header>: a blurred header would become the containing
          block for anything `fixed` inside it, squeezing the menu into 64px. */}
      {open && (
        <div
          id="mobile-menu"
          className="fixed inset-x-0 bottom-0 top-16 z-30 overflow-y-auto bg-paper md:hidden"
        >
          <nav
            className="site-container flex flex-col pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2"
            aria-label="القائمة"
          >
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="border-b border-line py-4 font-display text-xl"
              >
                {l.label}
              </Link>
            ))}
            <a href={botUrl} className="btn-primary mt-6 py-4 text-base" rel="noopener">
              <Send className="h-4 w-4 -scale-x-100" /> ابدأ على تيليجرام
            </a>
          </nav>
        </div>
      )}
    </>
  );
}

/** The store's robot next to the wordmark — the header and footer logo. */
export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <Image src="/robot-mark.png" alt="" width={36} height={36} priority className="h-9 w-9" />
      <Wordmark />
    </span>
  );
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-display text-xl font-extrabold tracking-tight ${className}`} dir="ltr">
      subsc<span className="text-tg">.</span>
    </span>
  );
}
