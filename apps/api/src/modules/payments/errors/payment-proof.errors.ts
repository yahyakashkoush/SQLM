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

export class TooManyProofAttemptsError extends DomainError {
  readonly httpStatus = HttpStatus.TOO_MANY_REQUESTS;
  readonly code = 'TOO_MANY_PROOFS';

  constructor(public readonly limit: number) {
    super(`This order already has ${limit} payment proofs. Contact support to continue.`);
    this.name = 'TooManyProofAttemptsError';
  }
}

export class ProofFileTooLargeError extends DomainError {
  readonly httpStatus = HttpStatus.PAYLOAD_TOO_LARGE;

  constructor(public readonly maxBytes: number) {
    super(`Payment proof is larger than ${Math.round(maxBytes / 1024 / 1024)}MB`);
    this.name = 'ProofFileTooLargeError';
  }
}
