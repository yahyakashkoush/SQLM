import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ClaimInstantGiftDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;
}

export class SubmitSocialRewardDto {
  @IsUUID()
  productId!: string;

  @IsIn(['FACEBOOK_COMMENT', 'FACEBOOK_RATING'])
  claimType!: 'FACEBOOK_COMMENT' | 'FACEBOOK_RATING';

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  facebookPostUrl?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  facebookProfileUrl?: string;

  /** URLs returned by POST /storage/upload — checked against our own storage in the service. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  proofScreenshots!: string[];
}

export class ReviewSocialRewardDto {
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}

export class CreateProductReviewDto {
  @IsString()
  @IsNotEmpty()
  orderId!: string;

  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachmentUrls?: string[];
}
