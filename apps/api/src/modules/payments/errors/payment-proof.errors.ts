import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';

export class OrderNotAwaitingPaymentError extends DomainError {
  readonly httpStatus = HttpStatus.CONFLICT;

  constructor(public readonly orderId: string) {
    super(`Order ${orderId} is not currently awaiting a payment proof`);
    this.name = 'OrderNotAwaitingPaymentError';
  }
}

/** Also the guard against duplicate admin approval/rejection racing on the same proof. */
export class ProofAlreadyReviewedError extends DomainError {
  readonly httpStatus = HttpStatus.CONFLICT;

  constructor(public readonly proofId: string) {
    super(`Payment proof ${proofId} has already been reviewed`);
    this.name = 'ProofAlreadyReviewedError';
  }
}

export class UnsupportedProofFileTypeError extends DomainError {
  readonly httpStatus = HttpStatus.BAD_REQUEST;

  constructor(public readonly mimeType: string) {
    super(`Unsupported file type: ${mimeType}. Only images and PDFs are accepted.`);
    this.name = 'UnsupportedProofFileTypeError';
  }
}
