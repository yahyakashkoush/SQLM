'use client';

import { useEffect, useState } from 'react';
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
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <header
      className={`sticky top-0 z-40 transition-[background,border-color] ${
        scrolled || open ? 'border-b border-line bg-paper/90 backdrop-blur' : 'border-b border-transparent'
      }`}
    >
      <div className="site-container flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2" aria-label="subsc — الرئيسية">
          <Wordmark />
        </Link>

        <nav className="hidden items-center gap-7 text-sm text-ink-soft md:flex" aria-label="الأقسام">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="transition hover:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a href={botUrl} className="btn-primary hidden !px-5 !py-2.5 sm:inline-flex" rel="noopener">
            <Send className="h-4 w-4 -scale-x-100" /> افتح البوت
          </a>
          <button
            type="button"
            className="rounded-full p-2.5 md:hidden"
            aria-label={open ? 'إغلاق القائمة' : 'فتح القائمة'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-40 bg-paper md:hidden">
          <nav className="site-container flex flex-col py-4" aria-label="القائمة">
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
    </header>
  );
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-display text-xl font-extrabold tracking-tight ${className}`} dir="ltr">
      subsc<span className="text-tg">.</span>
    </span>
  );
}
