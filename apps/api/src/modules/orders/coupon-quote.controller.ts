import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, MaxLength, ValidateNested } from 'class-validator';
import { CartPricingService } from './cart-pricing.service';
import { CouponNotUsableError } from '../coupons/errors/coupon.errors';
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
  constructor(private readonly pricing: CartPricingService) {}

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
    // The full pricing, so `total` includes any member discount and is
    // the number checkout will charge. Kept for clients that predate
    // POST /orders/quote.
    const quote = await this.pricing.quote(customer.id, dto.items, dto.code);
    if (!quote.coupon) throw new CouponNotUsableError('اكتب كود الخصم.');
    return {
      code: quote.coupon.code,
      subtotal: quote.subtotal.toString(),
      discount: quote.coupon.discount.toString(),
      total: quote.total.toString(),
    };
  }
}
