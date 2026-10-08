import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateTopUpDto {
  /** In the wallet currency (the store's default currency). */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100_000)
  amount!: number;

  @IsUUID()
  paymentMethodId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  senderReference?: string;
}

export class ReviewTopUpDto {
  @IsBoolean()
  approve!: boolean;

  /** Required when rejecting: the merchant is told why. */
  @ValidateIf((o: ReviewTopUpDto) => !o.approve)
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason?: string;

  /** Approve a different amount than requested — e.g. the transfer was short. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100_000)
  amount?: number;
}

export class AdjustWalletDto {
  /** Signed: positive credits the wallet, negative debits it. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-100_000)
  @Max(100_000)
  amount!: number;

  @IsIn(['ADJUSTMENT', 'REFUND'])
  type!: 'ADJUSTMENT' | 'REFUND';

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  note!: string;

  @IsOptional()
  @IsUUID()
  orderId?: string;
}

export class TopUpListQueryDto {
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED'])
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
}
