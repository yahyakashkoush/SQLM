import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ORDER_STATUSES, type OrderStatus } from '@sqlm/shared';

export class OrderQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;

  /** Admin only: order number, or customer name / @username. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class TransitionOrderDto {
  @IsIn(ORDER_STATUSES)
  toStatus!: OrderStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class BulkDeleteOrdersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  ids!: string[];

  /** Put a paid order's goods back in stock too. Unpaid orders always release theirs. */
  @IsOptional()
  @IsBoolean()
  restock?: boolean;
}
