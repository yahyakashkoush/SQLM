export const PAYMENT_PROOF_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type PaymentProofStatus = (typeof PAYMENT_PROOF_STATUSES)[number];
