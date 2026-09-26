import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
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
}
