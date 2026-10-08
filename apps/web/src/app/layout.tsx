import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'https://subsc.tech'),
  title: {
    default: 'subsc — اشتراكات رقمية أصلية على تيليجرام',
    template: '%s · subsc',
  },
  description:
    'ChatGPT و Canva و Adobe و CapCut و VPN وأكتر — اشتراكات أصلية بسعر أقل، دفع بفودافون كاش أو إنستاباي أو USDT، وتسليم في دقايق على تيليجرام.',
  openGraph: {
    type: 'website',
    locale: 'ar_EG',
    siteName: 'subsc',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#F7F5F0',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* App Router root layout: this covers every page, which is what the rule asks for. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Alexandria:wght@500;700;800&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap"
        />
      </head>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
