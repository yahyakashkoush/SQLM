import { IsString, IsUrl, IsOptional, IsArray, ArrayMinSize, IsInt, Min, Max, IsNotEmpty } from 'class-validator';

export class ClaimInstantGiftDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;
}

export class SubmitSocialRewardDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsString()
  @IsNotEmpty()
  claimType!: 'FACEBOOK_COMMENT' | 'FACEBOOK_RATING';

  @IsOptional()
  @IsUrl()
  facebookPostUrl?: string;

  @IsOptional()
  @IsUrl()
  facebookProfileUrl?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
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
