import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';

/**
 * Every way a code can fail to apply, carrying the reason in Arabic
 * because it is shown to the customer verbatim.
 *
 * One class rather than one per rule: the caller never branches on which
 * rule failed, it just shows the message, and a dozen near-identical
 * classes would only make that harder to read.
 */
export class CouponNotUsableError extends DomainError {
  readonly httpStatus = HttpStatus.BAD_REQUEST;

  constructor(message: string) {
    super(message);
    this.name = 'CouponNotUsableError';
  }
}
