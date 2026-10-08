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

/**
 * The total checkout computed is not the one the customer was shown —
 * a setting changed, their welcome gift was just taken by another order,
 * or a coupon ran out between the quote and the tap. Refused rather than
 * charged, and in Arabic because the Mini App shows it as-is and
 * re-quotes.
 */
export class OrderPriceChangedError extends DomainError {
  readonly httpStatus = HttpStatus.CONFLICT;
  readonly code = 'PRICE_CHANGED';

  constructor(public readonly expected: string, public readonly actual: string) {
    super(`السعر اتغيّر من ${expected} لـ ${actual} — راجع الإجمالي الجديد وأكّد تاني.`);
    this.name = 'OrderPriceChangedError';
  }
}
