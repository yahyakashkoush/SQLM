import { CreditCard } from 'lucide-react';

/** A payment method's uploaded brand mark, or a neutral card icon. */
export function PaymentLogo({
  src,
  className = 'h-9 w-9',
}: {
  src?: string | null;
  className?: string;
}) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-white ${className}`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- uploaded to the store's own storage host
        <img src={src} alt="" className="h-full w-full object-contain p-1" loading="lazy" />
      ) : (
        <CreditCard className="h-4 w-4 text-muted-foreground" />
      )}
    </span>
  );
}
