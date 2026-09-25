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
