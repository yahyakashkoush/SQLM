import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CheckoutDto } from './dto/checkout.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { JwtCustomerAuthGuard } from '../rbac/guards/jwt-customer-auth.guard';
import {
  CurrentCustomer,
  type AuthenticatedCustomer,
} from '../rbac/decorators/current-customer.decorator';

@Controller('orders')
@UseGuards(JwtCustomerAuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post('checkout')
  checkout(@CurrentCustomer() customer: AuthenticatedCustomer, @Body() dto: CheckoutDto) {
    return this.orders.checkout(customer.id, dto);
  }

  @Get()
  list(@CurrentCustomer() customer: AuthenticatedCustomer, @Query() query: OrderQueryDto) {
    return this.orders.listForCustomer(customer.id, query);
  }

  @Get(':id')
  findById(@CurrentCustomer() customer: AuthenticatedCustomer, @Param('id') id: string) {
    return this.orders.findByIdForCustomer(id, customer.id);
  }
}
