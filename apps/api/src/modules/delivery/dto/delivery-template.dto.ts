import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateDeliveryTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  /** Pre-filled into the staff delivery form, e.g. "Email: \nPassword: ". */
  @IsString()
  @MaxLength(5000)
  content!: string;

  /** Overrides the store-wide delivery message for products using this template. */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  message?: string | null;
}

export class UpdateDeliveryTemplateDto extends PartialType(CreateDeliveryTemplateDto) {}
