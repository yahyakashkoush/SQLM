import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { DeliveryDispatcher } from './delivery-dispatcher.service';
import { FulfillDeliveryDto } from './dto/fulfill-delivery.dto';
import { JwtStaffAuthGuard } from '../rbac/guards/jwt-staff-auth.guard';
import { PermissionsGuard } from '../rbac/guards/permissions.guard';
import { Permissions } from '../rbac/decorators/permissions.decorator';
import { CurrentStaff, type AuthenticatedStaff } from '../rbac/decorators/current-staff.decorator';

@Controller('admin/deliveries')
@UseGuards(JwtStaffAuthGuard, PermissionsGuard)
export class AdminDeliveryController {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly dispatcher: DeliveryDispatcher,
  ) {}

  @Get('pending')
  @Permissions('delivery.read')
  listPending() {
    return this.delivery.listPendingManual();
  }

  @Get('order/:orderId')
  @Permissions('delivery.read')
  listForOrder(@Param('orderId') orderId: string) {
    return this.delivery.listForOrderAdmin(orderId);
  }

  @Post(':id/fulfill')
  @Permissions('delivery.fulfill')
  fulfill(
    @Param('id') id: string,
    @Body() dto: FulfillDeliveryDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    return this.delivery.fulfillManually(id, staff.id, dto.content, dto.note);
  }

  @Patch(':id')
  @Permissions('delivery.fulfill')
  replace(
    @Param('id') id: string,
    @Body() dto: FulfillDeliveryDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    return this.delivery.replaceDeliveredContent(id, staff.id, dto.content, dto.note);
  }

  @Post(':id/resend')
  @Permissions('delivery.fulfill')
  resend(@Param('id') id: string) {
    return this.delivery.resend(id);
  }

  @Get(':id/content')
  @Permissions('delivery.fulfill')
  content(@Param('id') id: string) {
    return this.delivery.revealForAdmin(id);
  }

  /** Re-drives fulfillment for an order whose automatic delivery failed or was never enqueued. */
  @Post('order/:orderId/retry')
  @Permissions('delivery.fulfill')
  async retry(@Param('orderId') orderId: string) {
    await this.dispatcher.dispatch(orderId);
    return { enqueued: true };
  }
}
