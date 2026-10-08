import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CryptoWatchService } from './crypto-watch.service';
import { JwtCustomerAuthGuard } from '../rbac/guards/jwt-customer-auth.guard';
import {
  CurrentCustomer,
  type AuthenticatedCustomer,
} from '../rbac/decorators/current-customer.decorator';

@Controller('orders/:orderId/crypto-payment')
@UseGuards(JwtCustomerAuthGuard)
export class CryptoPaymentsController {
  constructor(private readonly watches: CryptoWatchService) {}

  /** Address, exact amount and live status. Polled by the Mini App while
   *  the customer waits, which is how the page flips itself to paid. */
  @Get()
  get(@Param('orderId') orderId: string, @CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.watches.findForOrder(orderId, customer.id);
  }

  /**
   * Gives the customer another full window.
   *
   * Cheaper for everyone than making them re-order: the amount stays
   * reserved, so a transfer already in flight still settles instead of
   * landing on a closed window and needing support.
   */
  @Post('extend')
  extend(@Param('orderId') orderId: string, @CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.watches.extendForOrder(orderId, customer.id);
  }
}
