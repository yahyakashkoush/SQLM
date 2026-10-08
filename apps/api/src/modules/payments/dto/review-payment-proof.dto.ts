import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RejectPaymentProofDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;

  /** If true, the order is cancelled outright; otherwise it returns to PENDING_PAYMENT so the customer can resubmit. */
  @IsOptional()
  @IsBoolean()
  cancelOrder?: boolean;

  /** Count this as a strike against the customer. Default: yes, unless the reason is "unclear photo". */
  @IsOptional()
  @IsBoolean()
  strike?: boolean;
}

export class ProofInternalNoteDto {
  @IsString()
  @MaxLength(1000)
  note!: string;
}
