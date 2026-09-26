import { Badge, type BadgeProps } from '@sqlm/ui';
import { ORDER_STATUS_LABELS_AR, type OrderStatus } from '@sqlm/shared';

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
  return <Badge variant={STATUS_VARIANT[status]}>{ORDER_STATUS_LABELS_AR[status]}</Badge>;
}
