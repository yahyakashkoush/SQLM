import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class FulfillDeliveryDto {
  /** What the customer receives — credentials, an activation code, instructions. Stored encrypted. */
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
