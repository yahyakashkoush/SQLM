import { PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

export class CreateCouponDto {
  /**
   * Letters, digits, dash and underscore only. Stored upper-cased, so the
   * pattern accepts either case and the service normalises — a code with a
   * space or an emoji is impossible to dictate over the phone.
   */
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{3,32}$/, {
    message: 'code must be 3-32 characters: letters, digits, - or _',
  })
  code!: string;

  @IsIn(['PERCENT', 'FIXED'])
  type!: 'PERCENT' | 'FIXED';

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  value!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minSubtotal?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxDiscount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  perCustomerLimit?: number;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateCouponDto extends PartialType(CreateCouponDto) {}

export class ApplyCouponDto {
  @IsString()
  code!: string;
}
