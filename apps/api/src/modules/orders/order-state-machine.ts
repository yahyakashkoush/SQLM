import { HttpStatus } from '@nestjs/common';
import { ORDER_TRANSITIONS, type OrderStatus } from '@sqlm/shared';
import { DomainError } from '../../common/errors/domain.error';

export { ORDER_TRANSITIONS };

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
