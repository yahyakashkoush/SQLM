import { PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const PAYMENT_PROVIDERS = ['MANUAL', 'BINANCE', 'BYBIT'] as const;

export class CreatePaymentMethodDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  accountNumber?: string;

  @IsOptional()
  @IsString()
  instructions?: string;

  @IsOptional()
  @IsString()
  qrCodeUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @IsOptional()
  @IsIn(PAYMENT_PROVIDERS)
  provider?: (typeof PAYMENT_PROVIDERS)[number];

  /** Upper-cased on save: the exchange reports tickers that way, and the
   *  poller matches on exact equality. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  cryptoAsset?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  cryptoNetwork?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  depositAddress?: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  watchTtlMinutes?: number;
}

export class UpdatePaymentMethodDto extends PartialType(CreatePaymentMethodDto) {}
