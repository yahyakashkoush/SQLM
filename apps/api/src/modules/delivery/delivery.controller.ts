import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { JwtCustomerAuthGuard } from '../rbac/guards/jwt-customer-auth.guard';
import {
  CurrentCustomer,
  type AuthenticatedCustomer,
} from '../rbac/decorators/current-customer.decorator';

@Controller('orders/:orderId/deliveries')
@UseGuards(JwtCustomerAuthGuard)
export class DeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  @Get()
  list(@Param('orderId') orderId: string, @CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.delivery.listForOrderCustomer(orderId, customer.id);
  }
}
