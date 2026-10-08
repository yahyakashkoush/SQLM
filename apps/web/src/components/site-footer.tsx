import Link from 'next/link';
import { Logo } from './site-header';

export function SiteFooter({ botUrl, supportContact }: { botUrl: string; supportContact: string }) {
  const handle = supportContact.startsWith('@') ? supportContact.slice(1) : null;
  return (
    <footer className="border-t border-line bg-paper">
      <div className="site-container grid gap-10 py-12 sm:grid-cols-[1.4fr,1fr,1fr]">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-xs text-sm leading-7 text-ink-soft">
            اشتراكات وأدوات رقمية أصلية، بالكامل من خلال تيليجرام.
          </p>
        </div>
        <div className="space-y-3 text-sm">
          <p className="font-semibold">المتجر</p>
          <ul className="space-y-2 text-ink-soft">
            <li>
              <Link href="/#products" className="hover:text-ink">المنتجات</Link>
            </li>
            <li>
              <Link href="/#how" className="hover:text-ink">طريقة الشراء</Link>
            </li>
            <li>
              <Link href="/terms" className="hover:text-ink">الشروط والأحكام</Link>
            </li>
          </ul>
        </div>
        <div className="space-y-3 text-sm">
          <p className="font-semibold">تواصل</p>
          <ul className="space-y-2 text-ink-soft">
            <li>
              <a href={botUrl} className="hover:text-ink" rel="noopener">
                بوت المتجر
              </a>
            </li>
            {supportContact && (
              <li dir="ltr" className="text-end">
                {handle ? (
                  <a href={`https://t.me/${handle}`} className="hover:text-ink" rel="noopener">
                    {supportContact}
                  </a>
                ) : (
                  supportContact
                )}
              </li>
            )}
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <p className="site-container py-5 text-xs text-ink-soft">© {new Date().getFullYear()} subsc — كل الحقوق محفوظة.</p>
      </div>
    </footer>
  );
}
