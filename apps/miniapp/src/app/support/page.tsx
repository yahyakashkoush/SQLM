import { LifeBuoy } from 'lucide-react';

export default function SupportPage() {
  return (
    <main className="flex flex-col items-center gap-3 p-8 text-center">
      <LifeBuoy className="h-10 w-10 text-muted-foreground" />
      <h1 className="text-lg font-semibold">Support</h1>
      <p className="text-sm text-muted-foreground">
        In-app support tickets are coming soon. For now, message the store directly in Telegram.
      </p>
    </main>
  );
}
