import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelOrderDto {
  /** Free text the customer may give; stored as the order's cancel reason. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
