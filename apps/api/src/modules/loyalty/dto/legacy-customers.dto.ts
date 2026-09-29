import { IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class ImportLegacyCustomersDto {
  /** One per line: phone[, name][, percent]. */
  @IsString()
  @MaxLength(300_000)
  text!: string;
}

export class UpdateLegacyCustomerDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(100)
  name?: string | null;

  /** null = fall back to the Settings percentage. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(0)
  @Max(90)
  discountPercent?: number | null;
}
