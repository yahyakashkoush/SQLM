import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ApplyWholesaleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  businessName!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(24)
  contactPhone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  monthlyVolume?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsBoolean()
  acceptTerms!: boolean;
}

export class ReviewWholesaleDto {
  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class WholesaleListQueryDto {
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED'])
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
}
