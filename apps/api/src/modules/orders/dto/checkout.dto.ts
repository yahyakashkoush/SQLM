import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
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
}

export class CheckoutDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  items!: CheckoutItemDto[];

  @IsUUID()
  paymentMethodId!: string;

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
