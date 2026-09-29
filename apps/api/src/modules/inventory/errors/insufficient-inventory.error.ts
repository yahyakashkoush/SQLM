import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';

/**
 * Thrown by the reservation primitives when there isn't enough stock to
 * satisfy a request. Deliberately not a NestJS HTTP exception at the throw
 * site — this crosses a transaction boundary inside OrdersService, deep
 * inside a Prisma transaction with no HTTP context — but `AllExceptionsFilter`
 * recognizes `DomainError` and maps it to `httpStatus` automatically.
 */
export class InsufficientInventoryError extends DomainError {
  readonly httpStatus = HttpStatus.CONFLICT;

  constructor(
    public readonly productId: string,
    public readonly requested: number,
    public readonly available: number,
  ) {
    super(
      `Insufficient inventory for product ${productId}: requested ${requested}, available ${available}`,
    );
    this.name = 'InsufficientInventoryError';
  }
}
