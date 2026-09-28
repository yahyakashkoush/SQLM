import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CartPricingService } from './cart-pricing.service';
import { OrdersController } from './orders.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { CouponQuoteController } from './coupon-quote.controller';
import { InventoryModule } from '../inventory/inventory.module';
import { CouponsModule } from '../coupons/coupons.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';

@Module({
  imports: [InventoryModule, CouponsModule, LoyaltyModule],
  controllers: [OrdersController, AdminOrdersController, CouponQuoteController],
  providers: [OrdersService, CartPricingService],
  exports: [OrdersService, CartPricingService],
})
export class OrdersModule {}
