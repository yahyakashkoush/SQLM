import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CouponsService } from './coupons.service';
import { CreateCouponDto, UpdateCouponDto } from './dto/coupon.dto';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Permissions } from '../rbac/decorators/permissions.decorator';

@Controller('admin/coupons')
@UseGuards(JwtStaffAuthGuard, PermissionsGuard)
export class AdminCouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  @Permissions('coupons.read')
  list() {
    return this.coupons.listAdmin();
  }

  @Post()
  @Permissions('coupons.write')
  create(@Body() dto: CreateCouponDto) {
    return this.coupons.createAdmin(dto);
  }

  @Patch(':id')
  @Permissions('coupons.write')
  update(@Param('id') id: string, @Body() dto: UpdateCouponDto) {
    return this.coupons.updateAdmin(id, dto);
  }

  /** Deactivates rather than deletes: orders reference the coupon that priced them. */
  @Delete(':id')
  @Permissions('coupons.write')
  deactivate(@Param('id') id: string) {
    return this.coupons.deactivateAdmin(id);
  }
}
