import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
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

  /** Re-drives fulfillment for an order whose automatic delivery failed or was never enqueued. */
  @Post('order/:orderId/retry')
  @Permissions('delivery.fulfill')
  async retry(@Param('orderId') orderId: string) {
    await this.dispatcher.dispatch(orderId);
    return { enqueued: true };
  }
}
