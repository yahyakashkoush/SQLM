import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CheckoutDto, QuoteOrderDto } from './dto/checkout.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
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

  /** Prices a cart for this customer — member discount, coupon, and the
   *  amount to transfer with each payment method — without placing it. */
  @Post('quote')
  @HttpCode(200)
  quote(@CurrentCustomer() customer: AuthenticatedCustomer, @Body() dto: QuoteOrderDto) {
    return this.orders.quoteForCustomer(customer.id, dto);
  }

  @Get()
  list(@CurrentCustomer() customer: AuthenticatedCustomer, @Query() query: OrderQueryDto) {
    return this.orders.listForCustomer(customer.id, query);
  }

  @Get(':id')
  findById(@CurrentCustomer() customer: AuthenticatedCustomer, @Param('id') id: string) {
    return this.orders.findByIdForCustomer(id, customer.id);
  }

  /** Walk away from an unpaid order, which also frees the stock it held. */
  @Post(':id/cancel')
  cancel(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Param('id') id: string,
    @Body() dto: CancelOrderDto,
  ) {
    return this.orders.cancelByCustomer(id, customer.id, dto.reason);
  }
}
