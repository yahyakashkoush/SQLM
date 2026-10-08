import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Permissions } from '../rbac/decorators/permissions.decorator';
import { CurrentStaff, type AuthenticatedStaff } from '../rbac/decorators/current-staff.decorator';
import { LegacyCustomersService } from './legacy-customers.service';
import { ImportLegacyCustomersDto, UpdateLegacyCustomerDto } from './dto/legacy-customers.dto';

@Controller('admin/legacy-customers')
@UseGuards(JwtStaffAuthGuard, PermissionsGuard)
export class AdminLegacyCustomersController {
  constructor(private readonly legacy: LegacyCustomersService) {}

  @Get()
  @Permissions('customers.read')
  list(@Query('search') search?: string) {
    return this.legacy.list(search);
  }

  @Post('import')
  @Permissions('customers.write')
  import(@Body() dto: ImportLegacyCustomersDto, @CurrentStaff() staff: AuthenticatedStaff) {
    return this.legacy.import(dto.text, staff.id);
  }

  @Patch(':id')
  @Permissions('customers.write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLegacyCustomerDto) {
    return this.legacy.update(id, dto);
  }

  @Post(':id/release')
  @Permissions('customers.write')
  release(@Param('id', ParseUUIDPipe) id: string, @CurrentStaff() staff: AuthenticatedStaff) {
    return this.legacy.release(id, staff.id);
  }

  @Delete(':id')
  @Permissions('customers.write')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentStaff() staff: AuthenticatedStaff) {
    return this.legacy.remove(id, staff.id);
  }
}
