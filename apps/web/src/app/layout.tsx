import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'SQLM — Digital Products Store',
    template: '%s · SQLM',
  },
  description: 'AI subscriptions, software licenses, and digital products — delivered fast.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
