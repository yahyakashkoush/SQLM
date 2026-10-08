import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';

/** A crypto method saved without the fields the poller needs to match on. */
export class CryptoMethodMisconfiguredError extends DomainError {
  readonly httpStatus = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(
    public readonly methodId: string,
    reason: string,
  ) {
    super(`Payment method ${methodId} is not usable for crypto settlement: ${reason}`);
    this.name = 'CryptoMethodMisconfiguredError';
  }
}

/**
 * Every candidate amount collided. Practically unreachable — it needs
 * thousands of simultaneously open watches on one asset — but failing
 * loudly beats handing two customers the same amount.
 */
export class AmountAllocationFailedError extends DomainError {
  readonly httpStatus = HttpStatus.SERVICE_UNAVAILABLE;

  constructor(
    public readonly orderId: string,
    attempts: number,
  ) {
    super(
      `Could not allocate a unique deposit amount for order ${orderId} after ${attempts} attempts`,
    );
    this.name = 'AmountAllocationFailedError';
  }
}
