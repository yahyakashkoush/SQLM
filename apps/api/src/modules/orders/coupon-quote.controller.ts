import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, MaxLength, ValidateNested } from 'class-validator';
import { CouponsService } from '../coupons/coupons.service';
import { CartPricingService } from './cart-pricing.service';
import { CheckoutItemDto } from './dto/checkout.dto';
import { JwtCustomerAuthGuard } from '../rbac/guards/jwt-customer-auth.guard';
import {
  CurrentCustomer,
  type AuthenticatedCustomer,
} from '../rbac/decorators/current-customer.decorator';

export class QuoteCouponDto {
  @IsString()
  @MaxLength(32)
  code!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  items!: CheckoutItemDto[];
}

/**
 * Lives in OrdersModule rather than CouponsModule because it prices a
 * cart, and CouponsModule must stay importable by OrdersModule without a
 * cycle. The route is still `/coupons/quote` — Nest does not tie a
 * controller's path to the module it is declared in.
 */
@Controller('coupons')
@UseGuards(JwtCustomerAuthGuard)
export class CouponQuoteController {
  constructor(
    private readonly coupons: CouponsService,
    private readonly pricing: CartPricingService,
  ) {}

  /**
   * Shows what a code is worth before the customer commits to it.
   *
   * Takes the cart, not a subtotal: a total posted by the client is a
   * total the client can edit, and pricing a percentage against it would
   * let anyone claim any discount. Checkout re-runs exactly this, so the
   * number quoted here is the number charged.
   */
  @Post('quote')
  async quote(@CurrentCustomer() customer: AuthenticatedCustomer, @Body() dto: QuoteCouponDto) {
    const subtotal = await this.pricing.subtotalFor(dto.items);
    const quote = await this.coupons.quote(dto.code, customer.id, subtotal);
    return {
      code: quote.code,
      subtotal: subtotal.toString(),
      discount: quote.discount.toString(),
      total: subtotal.sub(quote.discount).toString(),
    };
  }
}
