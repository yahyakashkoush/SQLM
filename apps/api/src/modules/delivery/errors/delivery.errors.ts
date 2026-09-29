import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';

export class DeliveryAlreadyCompletedError extends DomainError {
  readonly httpStatus = HttpStatus.CONFLICT;

  constructor(deliveryId: string) {
    super(`Delivery ${deliveryId} has already been completed`);
    this.name = 'DeliveryAlreadyCompletedError';
  }
}

export class DeliveryNotFulfillableError extends DomainError {
  readonly httpStatus = HttpStatus.CONFLICT;

  constructor(orderId: string, status: string) {
    super(`Order ${orderId} is not ready for delivery (status: ${status})`);
    this.name = 'DeliveryNotFulfillableError';
  }
}
