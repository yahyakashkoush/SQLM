import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { INVENTORY_ITEM_STATUSES, type InventoryItemStatus } from '@sqlm/shared';

export class InventoryQueryDto {
  @IsOptional()
  @IsIn(INVENTORY_ITEM_STATUSES)
  status?: InventoryItemStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 50;
}
