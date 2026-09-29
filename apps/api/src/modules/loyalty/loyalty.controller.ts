import { Controller, Get, UseGuards } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { JwtCustomerAuthGuard } from '../rbac/guards/jwt-customer-auth.guard';
import {
  CurrentCustomer,
  type AuthenticatedCustomer,
} from '../rbac/decorators/current-customer.decorator';

@Controller('me')
@UseGuards(JwtCustomerAuthGuard)
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  /** Tier, standing discount and welcome gift, for the Mini App. */
  @Get('perks')
  perks(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.loyalty.perksFor(customer.id);
  }
}
