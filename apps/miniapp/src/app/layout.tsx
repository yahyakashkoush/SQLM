import type { Metadata } from 'next';
import './globals.css';
import { TelegramProvider } from '@/components/providers/telegram-provider';
import { QueryProvider } from '@/components/providers/query-provider';
import { StoreHydration } from '@/components/providers/store-hydration';
import { BottomNav } from '@/components/layout/bottom-nav';

export const metadata: Metadata = {
  title: 'المتجر',
  description: 'اشتري الاشتراكات والمنتجات الرقمية من جوه تيليجرام.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen antialiased">
        <QueryProvider>
          <StoreHydration />
          <TelegramProvider>
            <div className="pb-16">{children}</div>
            <BottomNav />
          </TelegramProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
