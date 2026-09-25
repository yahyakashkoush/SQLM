import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrderQueryDto, TransitionOrderDto } from './dto/order-query.dto';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Permissions } from '../rbac/decorators/permissions.decorator';
import { CurrentStaff, type AuthenticatedStaff } from '../rbac/decorators/current-staff.decorator';

@Controller('admin/orders')
@UseGuards(JwtStaffAuthGuard, PermissionsGuard)
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @Permissions('orders.read')
  list(@Query() query: OrderQueryDto) {
    return this.orders.listAdmin(query);
  }

  @Get(':id')
  @Permissions('orders.read')
  findById(@Param('id') id: string) {
    return this.orders.findByIdAdmin(id);
  }

  @Post(':id/transition')
  @Permissions('orders.transition')
  transition(
    @Param('id') id: string,
    @Body() dto: TransitionOrderDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    return this.orders.transitionStandalone(
      id,
      dto.toStatus,
      { type: 'STAFF', staffId: staff.id },
      dto.note,
    );
  }
}
