import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';

export class ProductNotPurchasableError extends DomainError {
  readonly httpStatus = HttpStatus.CONFLICT;

  constructor(public readonly productId: string) {
    super(`Product ${productId} is not currently available for purchase`);
    this.name = 'ProductNotPurchasableError';
  }
}

export class PaymentMethodUnavailableError extends DomainError {
  readonly httpStatus = HttpStatus.BAD_REQUEST;

  constructor(public readonly paymentMethodId: string) {
    super(`Payment method ${paymentMethodId} is not available`);
    this.name = 'PaymentMethodUnavailableError';
  }
}

/**
 * Raised when a customer tries to cancel an order that has moved past the
 * point where walking away is their decision alone — a payment proof is in,
 * or the order is already paid.
 */
export class OrderNotCancellableError extends DomainError {
  readonly httpStatus = HttpStatus.CONFLICT;

  constructor(public readonly status: string) {
    super(
      `An order in ${status} can no longer be cancelled from the app — contact support instead`,
    );
    this.name = 'OrderNotCancellableError';
  }
}
