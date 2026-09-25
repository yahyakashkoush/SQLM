import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SQLM Store',
  description: 'Shop digital products inside Telegram.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
