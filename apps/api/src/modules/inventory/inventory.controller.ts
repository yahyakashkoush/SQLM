import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { InventoryService } from './inventory.service';
import { ImportInventoryDto } from './dto/import-inventory.dto';
import { InventoryQueryDto } from './dto/inventory-query.dto';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Permissions } from '../rbac/decorators/permissions.decorator';
import { CurrentStaff, type AuthenticatedStaff } from '../rbac/decorators/current-staff.decorator';

class DisableInventoryItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  reason!: string;
}

@Controller('admin/inventory')
@UseGuards(JwtStaffAuthGuard, PermissionsGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Post('products/:productId/import')
  @Permissions('inventory.write')
  bulkImport(@Param('productId') productId: string, @Body() dto: ImportInventoryDto) {
    return this.inventory.bulkImport(productId, dto.secrets);
  }

  @Get('products/:productId')
  @Permissions('inventory.read')
  listForProduct(@Param('productId') productId: string, @Query() query: InventoryQueryDto) {
    return this.inventory.listForProduct(productId, query);
  }

  @Post(':id/reveal')
  @Permissions('inventory.reveal_secret')
  reveal(@Param('id') id: string, @CurrentStaff() staff: AuthenticatedStaff) {
    return this.inventory.revealSecret(id, staff.id);
  }

  @Patch(':id/disable')
  @Permissions('inventory.write')
  disable(@Param('id') id: string, @Body() dto: DisableInventoryItemDto) {
    return this.inventory.disable(id, dto.reason);
  }
}
