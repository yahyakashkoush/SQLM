import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { OrdersService } from './orders.service';
import { BulkDeleteOrdersDto, OrderQueryDto, TransitionOrderDto } from './dto/order-query.dto';
import { OrderCleanupService } from './order-cleanup.service';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Permissions } from '../rbac/decorators/permissions.decorator';
import { CurrentStaff, type AuthenticatedStaff } from '../rbac/decorators/current-staff.decorator';
import { DeliveryDispatcher } from '../delivery/delivery-dispatcher.service';

class RefundOrderDto {
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsBoolean() restock?: boolean;
}

@Controller('admin/orders')
@UseGuards(JwtStaffAuthGuard, PermissionsGuard)
export class AdminOrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly delivery: DeliveryDispatcher,
    private readonly cleanup: OrderCleanupService,
  ) {}

  /** Declared before `:id` routes so "bulk-delete" is never read as an id. */
  @Post('bulk-delete')
  @Permissions('orders.delete')
  bulkDelete(@Body() dto: BulkDeleteOrdersDto, @CurrentStaff() staff: AuthenticatedStaff) {
    return this.cleanup.deleteMany(dto.ids, staff.id, dto.restock ?? false);
  }

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
  async transition(
    @Param('id') id: string,
    @Body() dto: TransitionOrderDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    const order = await this.orders.transitionStandalone(
      id,
      dto.toStatus,
      { type: 'STAFF', staffId: staff.id },
      dto.note,
    );
    // Same post-commit rule as the payment-approval path.
    if (dto.toStatus === 'PAID') await this.delivery.dispatch(id);
    return order;
  }

  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  @Permissions('orders.transition')
  refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundOrderDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    return this.orders.refundOrder(id, { type: 'STAFF', staffId: staff.id }, dto.note ?? '', dto.restock ?? false);
  }

  @Delete(':id')
  @Permissions('orders.delete')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('restock') restock: string | undefined,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    return this.cleanup.deleteOrder(id, staff.id, restock === 'true');
  }
}
