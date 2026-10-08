import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  DELIVERY_TYPES,
  FULFILLMENT_TYPES,
  INVENTORY_MODES,
  PRODUCT_STATUSES,
  PRODUCT_VISIBILITIES,
  type DeliveryType,
  type FulfillmentType,
  type InventoryMode,
  type ProductStatus,
  type ProductVisibility,
} from '@sqlm/shared';

export class ProductBundleDto {
  /** Existing bundle to update; omitted = a new bundle. */
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(1000)
  quantity!: number;

  /** Price of the whole bundle. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  price!: number;

  @IsOptional()
  @IsBoolean()
  wholesaleOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateProductDto {
  /** Generated from `name` when omitted. */
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase English letters, numbers and hyphens',
  })
  slug?: string;

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  shortDescription?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  compareAtPrice?: number;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  duration?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  warranty?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock?: number;

  @IsIn(INVENTORY_MODES)
  inventoryMode!: InventoryMode;

  @IsIn(DELIVERY_TYPES)
  deliveryType!: DeliveryType;

  @IsIn(FULFILLMENT_TYPES)
  fulfillmentType!: FulfillmentType;

  @IsOptional()
  @IsString()
  activationInstructions?: string;

  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: ProductStatus;

  @IsOptional()
  @IsIn(PRODUCT_VISIBILITIES)
  visibility?: ProductVisibility;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsUUID()
  deliveryTemplateId?: string | null;

  /** Not persisted: broadcast the product to all customers after saving. */
  @IsOptional()
  @IsBoolean()
  notifyCustomers?: boolean;

  @IsOptional()
  @IsIn(['INSTANT_FREE', 'SOCIAL_REWARD'])
  giftType?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxGiftClaims?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  badge?: string | null;

  @IsOptional()
  @IsUrl()
  socialPostUrl?: string | null;

  @IsOptional()
  @IsUrl()
  socialPageUrl?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  costPrice?: number | null;

  /** Star rating shown on the product (0–5), set by staff. Null hides the stars. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(5)
  ratingScore?: number | null;

  /** The number shown next to the stars. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  reviewCount?: number;

  /** Replaces the product's bundles: listed ones are kept/updated, others removed. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ProductBundleDto)
  bundles?: ProductBundleDto[];
}
