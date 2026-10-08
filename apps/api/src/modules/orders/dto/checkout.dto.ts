import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class CheckoutItemDto {
  @IsUUID()
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  quantity!: number;

  /** Buy this product as a bundle; `quantity` is then the number of bundles. */
  @IsOptional()
  @IsUUID()
  bundleId?: string;
}

export class CheckoutDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  items!: CheckoutItemDto[];

  /** Required unless the merchant pays from the wallet. */
  @ValidateIf((o: CheckoutDto) => o.payWithWallet !== true)
  @IsUUID()
  paymentMethodId?: string;

  /** Approved merchants: settle the order from the wallet balance at once. */
  @IsOptional()
  @IsBoolean()
  payWithWallet?: boolean;

  /** Client-generated (e.g. persisted per-cart in the Mini App). Retried checkout with the same key returns the original order. */
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;

  /** Re-validated and re-priced server-side; the quote the customer saw is
   *  never trusted, only the code they typed. */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  couponCode?: string;

  /** The total the customer was shown. When sent, checkout refuses to
   *  charge anything else (409 PRICE_CHANGED) instead of silently
   *  charging a different amount. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  expectedTotal?: number;

  /** Required on the customer's first order only; stored on the account after that. */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(24)
  contactPhone?: string;
}

/** A cart to price without placing it. */
export class QuoteOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  items!: CheckoutItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(32)
  couponCode?: string;
}
