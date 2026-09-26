export function statusVariant(status: string): 'success' | 'warning' | 'destructive' | 'secondary' {
  if (['DELIVERED', 'COMPLETED', 'PAID'].includes(status)) return 'success';
  if (['CANCELLED', 'REFUNDED', 'DISPUTED'].includes(status)) return 'destructive';
  if (['PAYMENT_REVIEW', 'PAYMENT_SUBMITTED', 'READY_FOR_DELIVERY', 'PROCESSING'].includes(status)) return 'warning';
  return 'secondary';
}

export const statusLabel = (status: string) => status.replace(/_/g, ' ').toLowerCase();
