import { Badge, type BadgeProps } from '@sqlm/ui';
import type { OrderStatus } from '@sqlm/shared';

const STATUS_LABEL: Record<OrderStatus, string> = {
  CREATED: 'Created',
  PENDING_PAYMENT: 'Awaiting payment',
  PAYMENT_SUBMITTED: 'Payment submitted',
  PAYMENT_REVIEW: 'Under review',
  PAID: 'Paid',
  PROCESSING: 'Processing',
  READY_FOR_DELIVERY: 'Ready for delivery',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
  DISPUTED: 'Disputed',
};

const STATUS_VARIANT: Record<OrderStatus, NonNullable<BadgeProps['variant']>> = {
  CREATED: 'secondary',
  PENDING_PAYMENT: 'warning',
  PAYMENT_SUBMITTED: 'warning',
  PAYMENT_REVIEW: 'warning',
  PAID: 'default',
  PROCESSING: 'default',
  READY_FOR_DELIVERY: 'default',
  DELIVERED: 'success',
  COMPLETED: 'success',
  CANCELLED: 'destructive',
  REFUNDED: 'destructive',
  DISPUTED: 'destructive',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}
