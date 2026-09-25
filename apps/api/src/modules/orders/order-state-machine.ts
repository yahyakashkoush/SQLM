import { HttpStatus } from '@nestjs/common';
import type { OrderStatus } from '@sqlm/shared';
import { DomainError } from '../../common/errors/domain.error';

/**
 * The single source of truth for which order transitions are legal.
 * `OrdersService.transition()` is the only code path allowed to change
 * `Order.status`, and it consults exactly this table — no controller,
 * webhook handler, or worker ever sets status directly.
 *
 * `CANCELLED` is reachable only from pre-payment-approval states by
 * construction, which is what lets `OrdersService` safely auto-release
 * inventory on any transition into `CANCELLED` without checking whether a
 * sale already happened — it never has, or the transition wouldn't be
 * allowed here in the first place.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  CREATED: ['PENDING_PAYMENT', 'CANCELLED'],
  PENDING_PAYMENT: ['PAYMENT_SUBMITTED', 'CANCELLED'],
  PAYMENT_SUBMITTED: ['PAYMENT_REVIEW', 'CANCELLED'],
  PAYMENT_REVIEW: ['PAID', 'PENDING_PAYMENT', 'CANCELLED'],
  PAID: ['PROCESSING', 'REFUNDED', 'DISPUTED'],
  PROCESSING: ['READY_FOR_DELIVERY', 'DISPUTED'],
  READY_FOR_DELIVERY: ['DELIVERED', 'DISPUTED'],
  DELIVERED: ['COMPLETED', 'DISPUTED'],
  COMPLETED: ['DISPUTED', 'REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
  DISPUTED: ['REFUNDED', 'COMPLETED', 'CANCELLED'],
};

export class InvalidOrderTransitionError extends DomainError {
  readonly httpStatus = HttpStatus.CONFLICT;

  constructor(
    public readonly from: OrderStatus,
    public readonly to: OrderStatus,
  ) {
    super(`Cannot transition order from ${from} to ${to}`);
    this.name = 'InvalidOrderTransitionError';
  }
}

export function assertTransitionAllowed(from: OrderStatus, to: OrderStatus): void {
  if (!ORDER_TRANSITIONS[from]?.includes(to)) {
    throw new InvalidOrderTransitionError(from, to);
  }
}
